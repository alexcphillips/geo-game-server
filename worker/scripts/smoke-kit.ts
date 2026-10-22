import { randomBytes } from "node:crypto";
import { GEO_API_PATHS, GEO_SOCKET_PATH, GEO_SOCKET_PING_SECONDS, type GeoSession, type GeoSocketServerMessage } from "@geo/shared";
import { ENV, IS_PRODUCTION } from "./env";
import { GEO_OPS_PATHS, ops, workerSql, workerUrl } from "./ops-client";

/**
 * What every smoke test needs: a typed call, throwaway accounts, and their
 * clean-up. Smoke tests are dev only — they make real (if short-lived)
 * geo-game accounts.
 *
 * They run against the Cloudflare Worker: `npm run dev:worker`
 * (http://localhost:8787, the default) or `--url <base>` (workers.dev while
 * its dev tools are on). Setup and checks go through its operator routes
 * (GEO_OPS_SECRET): `sql` runs SQLite on the World, and `grant`, `coins`,
 * `xp`… reach into the game where the API has no way in.
 */
if (IS_PRODUCTION) throw new Error("geo smoke tests refuse to run in production");

export async function startSmokeServer() {
    const base = workerUrl();
    const health = await fetch(base + GEO_API_PATHS.health).catch(() => null);
    if (!health?.ok) throw new Error(`No Worker at ${base}: start one with \`npm run dev:worker\`, or pass --url <base>`);
    const emails: string[] = [];
    const sockets: WebSocket[] = [];

    async function call<T>(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: T }> {
        const response = await fetch(base + path, {
            method,
            headers: {
                "Content-Type": "application/json",
                // Sign-ups and sign-ins skip the rate limits (dev tools only), so a suite can make its accounts.
                ...(ENV.GEO_OPS_SECRET ? { "X-Geo-Ops": ENV.GEO_OPS_SECRET } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
    }

    /** A new geo-game account and its player, signed in. */
    async function registerPlayer(prefix = "smoke"): Promise<GeoSession & { email: string; password: string }> {
        const tag = randomBytes(4).toString("hex");
        const email = `${prefix}-${tag}@geo-smoke.test`;
        const password = `pw-${tag}-long-enough`;
        emails.push(email);
        const response = await call<GeoSession>("POST", GEO_API_PATHS.auth.register, undefined, {
            username: `${prefix}-${tag}`,
            email,
            password,
        });
        if (response.status !== 201) throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`);
        return { ...response.body, email, password };
    }

    /** Puts items straight into a player's inventory, for a test that needs more than the starter kit. */
    async function grant(playerId: string, items: { itemId: string; quantity: number; chargesLeft?: number }[]) {
        return (await ops<{ ids: string[] }>(base, GEO_OPS_PATHS.grant, { playerId, items })).ids;
    }

    /** One SQLite statement on the World, in its own transaction: its rows. Times are ms, JSON is text. */
    const sql = <Row>(text: string, params: unknown[] = []) => workerSql<Row>(base, text, params);

    /** Coins through the ledger, as a sale or a grant would ("admin-grant" unless said). */
    const coins = (playerId: string, amount: number, reason?: string) =>
        ops(base, GEO_OPS_PATHS.coins, { playerId, amount, reason, reference: "smoke" });
    /** Skill XP, and the active pet's share of it. */
    const xp = (playerId: string, skill: string, amount: number) => ops(base, GEO_OPS_PATHS.xp, { playerId, skill, amount });
    /** Quest progress, as a won fight records it. */
    const questEvents = (playerId: string, events: unknown[]) => ops(base, GEO_OPS_PATHS.questEvents, { playerId, events });
    /** The player's own stat modifiers (gear, pet, talismans). */
    const modifiers = async (playerId: string) =>
        (await ops<{ modifiers: { stat: string; value: number }[] }>(base, GEO_OPS_PATHS.modifiers, { playerId })).modifiers;
    /** Pays out farm weeks finished by `at` (ms), as the Monday job does. */
    const farmWeeks = (at: number) => ops(base, GEO_OPS_PATHS.farmWeeks, { at });
    /** Runs every job due by `at` (ms), as the World's alarm does. */
    const runJobs = (at = Date.now()) => ops(base, GEO_OPS_PATHS.jobs, { at });
    /** Moves the player's spawns' out-of-reach countdowns `seconds` on, rather than wait. */
    const spawnClock = (playerId: string, seconds: number) => ops(base, GEO_OPS_PATHS.spawnClock, { playerId, seconds });
    const makeAdmin = (playerId: string) => sql(`UPDATE players SET role = 'admin' WHERE id = ?`, [playerId]);

    /**
     * A geo socket, signed in with `token` (or sent `auth` as given, to test
     * refusals). `next` waits for the first message, from now on or already
     * waiting, that `match` accepts. It pings as the app does, or the server
     * would close it as gone quiet.
     */
    function openSocket(token: string | null, auth?: string) {
        const ws = new WebSocket(base.replace("http", "ws") + GEO_SOCKET_PATH);
        sockets.push(ws);
        const inbox: GeoSocketServerMessage[] = [];
        const waiting: { match: (m: GeoSocketServerMessage) => boolean; resolve: (m: GeoSocketServerMessage) => void }[] = [];
        let closeCode: number | null = null;
        const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve((closeCode = event.code))));
        const pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), GEO_SOCKET_PING_SECONDS * 1000);
        void closed.then(() => clearInterval(pinger));
        ws.addEventListener("open", () => ws.send(auth ?? JSON.stringify({ type: "auth", token })));
        ws.addEventListener("message", (event) => {
            const text = String(event.data);
            if (text === "pong") return;
            const message = JSON.parse(text) as GeoSocketServerMessage;
            const i = waiting.findIndex((w) => w.match(message));
            if (i >= 0) waiting.splice(i, 1)[0]!.resolve(message);
            else inbox.push(message);
        });
        function next<T extends GeoSocketServerMessage>(match: (m: GeoSocketServerMessage) => m is T, ms = 5000): Promise<T> {
            const i = inbox.findIndex(match);
            if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0] as T);
            return new Promise<T>((resolve, reject) => {
                const timer = setTimeout(() => {
                    const state = closeCode === null ? `open (readyState ${ws.readyState})` : `closed ${closeCode}`;
                    reject(new Error(`no matching socket message in time; the socket is ${state}`));
                }, ms);
                waiting.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m as T)) });
            });
        }
        /** Forgets what's arrived so far. */
        const drain = () => void inbox.splice(0);
        return { ws, next, drain, closed, ping: () => ws.send("ping") };
    }

    /** Deletes the throwaway players, then shuts down. */
    async function stop() {
        for (const ws of sockets) ws.close();
        // One at a time: deleting a seller refunds their bidders (a trigger).
        for (const email of emails) await sql(`DELETE FROM players WHERE email = ?`, [email]);
    }

    return { call, registerPlayer, grant, sql, coins, xp, questEvents, modifiers, farmWeeks, runJobs, spawnClock, makeAdmin, openSocket, stop, base };
}

export const step = (name: string) => console.log(`✓ ${name}`);
