import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { GEO_API_PATHS, GEO_SOCKET_PATH, type GeoSession, type GeoSocketServerMessage } from "@geo/shared";
import { IS_PRODUCTION } from "../config/env";
import { pool } from "../db";
import { errorHandler, notFoundHandler } from "../middleware/errorHandler";
import { ensureGeoSchema } from "../db/geo.schema";
import { withTransaction } from "../db/transaction";
import { geoRouter } from "../geo.routes";
import { attachGeoSocket } from "../realtime/geo-socket";
import { grantItems } from "../modules/player/geo-player.repository";
import { GEO_OPS_PATHS, ops, workerSql, workerUrl } from "./ops-client";

/**
 * What every smoke test needs: the geo router on a spare port, a typed call,
 * throwaway accounts, and their clean-up. Smoke tests are dev only — they
 * make real (if short-lived) geo-game accounts.
 *
 * With `--url <base>` they run against the Cloudflare Worker there instead
 * (`npm run dev:worker`, or workers.dev while its dev tools are on): grants
 * and clean-up go through its operator routes (GEO_OPS_SECRET), and `sql`
 * runs SQLite on its World. A suite's own Postgres queries (`pool`) don't
 * reach the Worker yet; moving them to `sql` is session 5's.
 */
if (IS_PRODUCTION) throw new Error("geo smoke tests refuse to run in production");

/** The Express server on a spare port, for a run without `--url`. */
async function startExpress() {
    const app = express();
    app.use(express.json());
    app.use(geoRouter);
    app.use(notFoundHandler);
    app.use(errorHandler);
    await ensureGeoSchema();
    const server = app.listen(0);
    attachGeoSocket(server);
    return server;
}

export async function startSmokeServer() {
    const worker = workerUrl();
    const server = worker ? null : await startExpress();
    const base = worker ?? `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const emails: string[] = [];
    const sockets: WebSocket[] = [];

    async function call<T>(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: T }> {
        const response = await fetch(base + path, {
            method,
            headers: {
                "Content-Type": "application/json",
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
        if (worker) return (await ops<{ ids: string[] }>(worker, GEO_OPS_PATHS.grant, { playerId, items })).ids;
        return withTransaction((tx) => grantItems(tx, playerId, items));
    }

    /** One SQLite statement on the Worker's World (with `--url` only): its rows. */
    async function sql<Row>(text: string, params: unknown[] = []): Promise<Row[]> {
        if (!worker) throw new Error("sql() is for --url runs; use pool against Postgres");
        return workerSql<Row>(worker, text, params);
    }

    /**
     * A geo socket, signed in with `token` (or sent `auth` as given, to test
     * refusals). `next` waits for the first message, from now on or already
     * waiting, that `match` accepts.
     */
    function openSocket(token: string | null, auth?: string) {
        const ws = new WebSocket(base.replace("http", "ws") + GEO_SOCKET_PATH);
        sockets.push(ws);
        const inbox: GeoSocketServerMessage[] = [];
        const waiting: { match: (m: GeoSocketServerMessage) => boolean; resolve: (m: GeoSocketServerMessage) => void }[] = [];
        const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
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
                const timer = setTimeout(() => reject(new Error("no matching socket message in time")), ms);
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
        server?.close();
        // One at a time: deleting a seller refunds their bidders (a trigger),
        // which Postgres refuses when a bidder is deleted by the same statement.
        for (const email of emails) {
            if (worker) await workerSql(worker, `DELETE FROM players WHERE email = ?`, [email]);
            else await pool.query(`DELETE FROM geo.players WHERE email = $1`, [email]);
        }
        await pool.end();
    }

    return { call, registerPlayer, grant, sql, openSocket, stop, worker };
}

export const step = (name: string) => console.log(`✓ ${name}`);
