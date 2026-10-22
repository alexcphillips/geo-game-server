import { runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
    GEO_API_PATHS,
    GEO_DUNGEON_RECONNECT_SECONDS,
    GEO_SOCKET_CLOSE,
    GEO_SOCKET_PATH,
    GEO_SOCKET_REAUTH_SECONDS,
    type GeoDungeonsResponse,
    type GeoFriendsResponse,
    type GeoSocketServerMessage,
} from "@geo/shared";
import { IDLE_MS, OFFLINE_GRACE_MS } from "../src/realtime/hub";
import { runDueJobs } from "../src/jobs";
import { goneSince } from "../src/realtime/presence";
import { dueAt } from "../src/modules/jobs/jobs.repository";
import { openSharedCombatRun } from "../src/modules/runs/runs.repository";
import type { World } from "../src/world";
import { call, inWorld, newPlayer, path, rowsWrittenBy, world } from "./helpers";

/** The geo socket: hibernating WebSockets on the World (src/realtime). */

const HERE = { latitude: 51.5007, longitude: -0.1246 };

type Socket = Awaited<ReturnType<typeof openSocket>>;

/** A socket to the World, signed in with `auth` (a token, or raw text to send as is). */
async function openSocket(auth: { token: string } | { raw: string } | null) {
    const response = await SELF.fetch(`https://geo-game.test${GEO_SOCKET_PATH}`, {
        headers: { Upgrade: "websocket", "CF-Connecting-IP": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    });
    expect(response.status).toBe(101);
    const ws = response.webSocket!;
    ws.accept();
    const inbox: (GeoSocketServerMessage | "pong")[] = [];
    const waiting: { match: (m: GeoSocketServerMessage | "pong") => boolean; resolve: (m: GeoSocketServerMessage | "pong") => void }[] = [];
    const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
    ws.addEventListener("message", (event) => {
        const text = String(event.data);
        const message = text === "pong" ? "pong" : (JSON.parse(text) as GeoSocketServerMessage);
        const i = waiting.findIndex((w) => w.match(message));
        if (i >= 0) waiting.splice(i, 1)[0]!.resolve(message);
        else inbox.push(message);
    });
    /** The first message, already here or still to come, that `match` takes. */
    function next<T extends GeoSocketServerMessage | "pong">(match: (m: GeoSocketServerMessage | "pong") => m is T, label = "a message", ms = 2000): Promise<T> {
        const i = inbox.findIndex(match);
        if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0] as T);
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`no ${label} in time; got ${JSON.stringify(inbox)}`)), ms);
            waiting.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m as T)) });
        });
    }
    if (auth) ws.send("raw" in auth ? auth.raw : JSON.stringify({ type: "auth", token: auth.token }));
    return { ws, next, closed, inbox, drain: () => void inbox.splice(0) };
}

const is =
    <K extends GeoSocketServerMessage["type"]>(type: K) =>
    (m: GeoSocketServerMessage | "pong"): m is Extract<GeoSocketServerMessage, { type: K }> =>
        m !== "pong" && m.type === type;
const friendsHint = (m: GeoSocketServerMessage | "pong"): m is Extract<GeoSocketServerMessage, { type: "changed" }> =>
    m !== "pong" && m.type === "changed" && m.topic === "friends";

/** Signs in and waits for the sign-in snapshots. */
async function signedIn(token: string): Promise<Socket> {
    const socket = await openSocket({ token });
    await socket.next(is("ready"));
    await socket.next(is("badges"));
    await socket.next(is("lobby"));
    return socket;
}

/** Runs the hub's sweep as if at `at` (graces, silence, tokens). */
const sweepAt = (at: number) => runInDurableObject(world(), (instance: World) => instance.hub.sweep(at));

/** Makes the player's sockets' token run out `msLeft` from now, as if they signed in an hour ago. */
const expireIn = (playerId: string, msLeft: number) =>
    runInDurableObject(world(), (_instance: World, state) => {
        for (const ws of state.getWebSockets()) {
            const attachment = ws.deserializeAttachment() as { playerId: string | null } | null;
            if (attachment?.playerId === playerId) ws.serializeAttachment({ ...attachment, expiresAt: Date.now() + msLeft, reauthSent: false });
        }
    });

async function befriend(a: { token: string }, b: { token: string; me: () => Promise<{ player: { displayName: string } }> }) {
    await call("POST", GEO_API_PATHS.friends.requests, a.token, { username: (await b.me()).player.displayName });
    const incoming = (await call<GeoFriendsResponse>("GET", GEO_API_PATHS.friends.root, b.token)).body.incoming;
    await call("POST", path(GEO_API_PATHS.friends.accept, { requestId: incoming[0]!.id }), b.token);
}

const statusOf = async (viewer: { token: string }, friendId: string) =>
    (await call<GeoFriendsResponse>("GET", GEO_API_PATHS.friends.root, viewer.token)).body.friends.find((f) => f.playerId === friendId)!.status;

describe("the geo socket", () => {
    it("wants an upgrade, a good token first, and answers pings", async () => {
        expect((await call("GET", GEO_SOCKET_PATH)).status).toBe(426);

        const bad = await openSocket({ token: "not-a-token" });
        expect(await bad.closed).toBe(GEO_SOCKET_CLOSE.unauthorized);
        const notAuth = await openSocket({ raw: "hello" });
        expect(await notAuth.closed).toBe(GEO_SOCKET_CLOSE.unauthorized);

        const player = await newPlayer("sock");
        const socket = await openSocket({ token: player.token });
        await socket.next(is("ready"));
        const badges = await socket.next(is("badges"));
        expect(badges.badges).toEqual({ incomingRequests: 0, unreadInbox: 0, pendingChests: 0 });
        expect((await socket.next(is("lobby"))).lobby).toBeNull();
        socket.ws.send("ping");
        expect(await socket.next((m): m is "pong" => m === "pong")).toBe("pong");
        // Anything else once signed in is ignored, not fatal.
        socket.ws.send("whatever");
        socket.ws.send("ping");
        await socket.next((m): m is "pong" => m === "pong");
        socket.ws.close();
    });

    it("signing in writes nothing", async () => {
        const player = await newPlayer("sock");
        let socket: Socket | undefined;
        expect(await rowsWrittenBy(async () => (socket = await signedIn(player.token)))).toBe(0);
        socket!.ws.close();
    });

    it("shows friends who's online and what they're doing, and pushes badges", async () => {
        const a = await newPlayer("pal");
        const b = await newPlayer("pal");
        const aSocket = await signedIn(a.token);
        await befriend(a, b);
        expect(await statusOf(a, b.id)).toEqual({ online: false });

        // Ben's app: a friend request to Ben is a badge.
        const c = await newPlayer("pal");
        const bSocket = await signedIn(b.token);
        await aSocket.next(friendsHint);
        expect(await statusOf(a, b.id)).toEqual({ online: true, activity: "exploring", skill: null });
        await call("POST", GEO_API_PATHS.friends.requests, c.token, { username: (await b.me()).player.displayName });
        expect((await bSocket.next(is("badges"))).badges.incomingRequests).toBe(1);

        aSocket.drain();
        expect((await call("POST", GEO_API_PATHS.presence, b.token, { activity: "skilling", skill: "fishing" })).status).toBe(204);
        await aSocket.next(friendsHint);
        expect(await statusOf(a, b.id)).toEqual({ online: true, activity: "skilling", skill: "fishing" });

        // Ben closes the app: still here through the grace, then gone, and Ana hears.
        aSocket.drain();
        bSocket.ws.close();
        await bSocket.closed;
        expect((await statusOf(a, b.id)).online).toBe(true);
        await sweepAt(Date.now() + OFFLINE_GRACE_MS + 1);
        await aSocket.next(friendsHint);
        expect(await statusOf(a, b.id)).toEqual({ online: false });
        // A report with no socket is ignored.
        expect((await call("POST", GEO_API_PATHS.presence, b.token, { activity: "trading" })).status).toBe(204);
        expect(await statusOf(a, b.id)).toEqual({ online: false });
        aSocket.ws.close();
    });

    it("sends reauth before the token runs out, takes a fresh one, and closes on an expired one", async () => {
        const player = await newPlayer("sock");
        const socket = await signedIn(player.token);
        const expiresAt = JSON.parse(atob(player.token.split(".")[1]!)).exp * 1000;
        // The alarm is set by the minute at or after the reauth time.
        const alarm = await runInDurableObject(world(), (instance: World) => instance.hub.nextWake());
        expect(alarm).toBeLessThanOrEqual(Math.ceil((expiresAt - GEO_SOCKET_REAUTH_SECONDS * 1000) / 60_000) * 60_000);

        await expireIn(player.id, GEO_SOCKET_REAUTH_SECONDS * 1000 - 1000);
        await sweepAt(Date.now());
        await socket.next(is("reauth"), "reauth");
        // A fresh token for the same player keeps it open past the old one.
        const fresh = (await call<{ accessToken: string }>("POST", GEO_API_PATHS.auth.login, undefined, { email: player.email, password: player.password })).body.accessToken;
        socket.ws.send(JSON.stringify({ type: "auth", token: fresh }));
        // Nothing answers a reauth, and the runtime's pong can beat the token check, so wait on the expiry itself.
        await vi.waitFor(async () => {
            const renewed = await runInDurableObject(world(), (instance: World) => instance.hub.nextWake());
            expect(renewed).toBeGreaterThan(Date.now() + 30 * 60_000);
        });
        // Someone else's token isn't taken.
        const other = await newPlayer("other");
        socket.ws.send(JSON.stringify({ type: "auth", token: other.token }));
        expect(await socket.closed).toBe(GEO_SOCKET_CLOSE.unauthorized);

        // Not renewed: closed when it runs out.
        const again = await signedIn(player.token);
        await expireIn(player.id, -1);
        await sweepAt(Date.now());
        expect(await again.closed).toBe(GEO_SOCKET_CLOSE.unauthorized);
    });

    it("closes a socket gone silent", async () => {
        const player = await newPlayer("sock");
        const socket = await signedIn(player.token);
        await sweepAt(Date.now() + IDLE_MS + 1);
        expect(await socket.closed).not.toBe(GEO_SOCKET_CLOSE.unauthorized);
        expect(await runInDurableObject(world(), (instance: World) => instance.hub.isConnected(player.id))).toBe(false);
    });

    it("closes a banned player's sockets", async () => {
        const boss = await newPlayer("boss");
        await inWorld((db) => db.run(`UPDATE players SET role = 'admin' WHERE id = ?;`, boss.id));
        const target = await newPlayer("sock");
        const socket = await signedIn(target.token);
        await call("POST", path(GEO_API_PATHS.admin.playerBan, { playerId: target.id }), boss.token, { banned: true });
        expect(await socket.closed).toBe(GEO_SOCKET_CLOSE.banned);
        // And can't sign in again.
        const back = await openSocket({ token: target.token });
        expect(await back.closed).toBe(GEO_SOCKET_CLOSE.banned);
    });

    it("pushes lobbies and the party map, and wakes the map when someone drops", async () => {
        const host = await newPlayer("host");
        const guest = await newPlayer("guest");
        const hostSocket = await signedIn(host.token);
        const guestSocket = await signedIn(guest.token);
        const lobby = (await call<GeoDungeonsResponse>("POST", GEO_API_PATHS.dungeons.lobbies, host.token, { dungeonId: "slime-pits", requiredLevel: 0, position: HERE, place: HERE })).body.myLobby!;
        await call("POST", path(GEO_API_PATHS.dungeons.join, { lobbyId: lobby.id }), guest.token, { position: HERE, place: HERE });
        const withGuest = (m: GeoSocketServerMessage | "pong"): m is Extract<GeoSocketServerMessage, { type: "lobby" }> =>
            is("lobby")(m) && m.lobby?.members?.length === 2;
        await hostSocket.next(withGuest, "the lobby with the guest");
        await call("POST", path(GEO_API_PATHS.dungeons.start, { lobbyId: lobby.id }), host.token);
        const map = await guestSocket.next(is("dungeonRun"), "the party map");
        await guestSocket.next((m): m is Extract<GeoSocketServerMessage, { type: "lobby" }> => is("lobby")(m) && m.lobby === null, "the lobby gone");

        // A reconnect gets the map as it stands.
        const hostAgain = await signedIn(host.token);
        expect((await hostAgain.next(is("dungeonRun"), "the map on connect")).dungeonRun.id).toBe(map.dungeonRun.id);

        // The guest drops: once the grace is over, the map looks again when their reconnect window is up.
        const droppedAt = Date.now();
        guestSocket.ws.close();
        await guestSocket.closed;
        await sweepAt(Date.now() + OFFLINE_GRACE_MS + 1);
        const wake = await inWorld((db) => dueAt(db, `dungeon:${map.dungeonRun.id}`));
        expect(wake).not.toBeNull();
        expect(wake!).toBeLessThanOrEqual(Date.now() + GEO_DUNGEON_RECONNECT_SECONDS * 1000);
        expect(wake!).toBeGreaterThanOrEqual(droppedAt + GEO_DUNGEON_RECONNECT_SECONDS * 1000 - 1000);
        // When they went is saved: a World back from hibernation has forgotten its memory of it.
        const gone = await inWorld((db) => db.one<{ since: number }>(`SELECT since FROM gone WHERE player_id = ?;`, guest.id)?.since);
        expect(gone).toBeGreaterThanOrEqual(droppedAt - 1000);
        expect(await runInDurableObject(world(), (instance: World) => goneSince(instance.state, guest.id))).toBe(gone);
        // Back: forgotten.
        const guestBack = await signedIn(guest.token);
        expect(await inWorld((db) => db.one(`SELECT since FROM gone WHERE player_id = ?;`, guest.id))).toBeUndefined();
        guestBack.ws.close();
        hostSocket.ws.close();
        hostAgain.ws.close();
    });

    it("gives a shared fight on connect, and skips the turn of a player who dropped", async () => {
        const a = await newPlayer("party");
        const b = await newPlayer("party");
        const aSocket = await signedIn(a.token);
        const bSocket = await signedIn(b.token);
        const opened = await inWorld((_db, instance) =>
            openSharedCombatRun(
                instance.state,
                [
                    { playerId: a.id, startHealth: 100 },
                    { playerId: b.id, startHealth: 100 },
                ],
                { enemyId: "spider", spawnId: null, keepsHealth: true },
            ),
        );
        const run = opened.opened.get(a.id)!.run;
        // Both here: the full turn.
        const fullTurn = Date.parse(run.turnDeadline!);

        // A reconnect gets the fight as it stands.
        const aAgain = await signedIn(a.token);
        expect((await aAgain.next(is("run"), "the fight on connect")).run.run.id).toBe(run.id);

        // Whoever is up drops: once the grace is over they count as gone, their turn is skipped when it's up, and the other hears.
        const actor = run.currentActor;
        const actorIsA = await inWorld((db) => db.one<{ combatant_id: string }>(`SELECT combatant_id FROM runs WHERE id = ?;`, run.id)!.combatant_id === actor);
        const [leaver, stayer] = actorIsA ? [[aSocket, aAgain], bSocket] : [[bSocket], aSocket];
        for (const socket of leaver) socket.ws.close();
        await Promise.all(leaver.map((socket) => socket.closed));
        await sweepAt(Date.now() + OFFLINE_GRACE_MS + 1);
        expect(await runInDurableObject(world(), (instance: World) => instance.hub.offlineSince(actorIsA ? a.id : b.id))).not.toBeNull();
        stayer.drain();
        await inWorld((_db, instance) => runDueJobs(instance.state, fullTurn + 1));
        const pushed = await stayer.next(is("run"), "the skipped turn");
        expect(pushed.run.run.currentActor).not.toBe(actor);
        stayer.ws.close();
        if (!actorIsA) aAgain.ws.close();
    });
});
