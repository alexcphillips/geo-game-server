import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { WebSocket, WebSocketServer } from "ws";
import {
    GEO_SOCKET_AUTH_SECONDS,
    GEO_SOCKET_CLOSE,
    GEO_SOCKET_PATH,
    GEO_SOCKET_PING,
    GEO_SOCKET_PING_SECONDS,
    GEO_SOCKET_PONG,
    GEO_SOCKET_REAUTH_SECONDS,
    type GeoSocketAuthMessage,
    type GeoSocketServerMessage,
} from "@geo/shared";
import { query } from "../db";
import { verifyAccessToken } from "../lib/geo-tokens";
import { findActiveView } from "../modules/dungeon-runs/geo-dungeon-runs.repository";
import { pushOwnLobby } from "../modules/dungeons/geo-dungeons.repository";
import { resetPresence } from "../modules/friends/geo-friends.repository";
import { findRecentSharedRun } from "../modules/runs/geo-runs.repository";
import { pushBadges } from "./geo-badges";
import * as socketHub from "./geo-socket-hub";

/**
 * The geo socket on Node: `ws` on the API.s own HTTP server, at
 * GEO_SOCKET_PATH, so it shares the API's port, TLS and proxy. The protocol
 * is in `realtime.contract.ts`; who gets what is in `geo-socket-hub.ts`.
 * This file only carries bytes, so a Cloudflare port replaces it alone.
 */

/** Silent this long (no ping, nothing): the phone is gone without saying so. Two missed pings and a bit. */
const IDLE_MS = (GEO_SOCKET_PING_SECONDS * 2 + 10) * 1000;
/** auth is a token and a few bytes; anything big is not ours. */
const MAX_MESSAGE_BYTES = 8 * 1024;
/** Queued and not yet sent past this, the phone isn't keeping up: drop it; it reconnects to fresh snapshots. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
/** setTimeout tops out at about 24.8 days. */
const MAX_TIMER_MS = 2 ** 31 - 1;

type AccessRow = { banned_at: Date | null };

export function attachGeoSocket(server: Server): void {
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
    const lastHeard = new Map<WebSocket, number>();
    // Nobody is connected yet, so nobody is online; sign-ins wait for this.
    const presenceReset = resetPresence().catch((error: unknown) => console.error("geo socket: presence reset failed", error));

    server.on("upgrade", (request, socket, head) => {
        const path = (request.url ?? "").split("?")[0];
        if (path !== GEO_SOCKET_PATH) {
            // Someone else's (another socket may be added later); with nobody else listening, nobody's.
            // A second listener must destroy what isn't its own and that isn't GEO_SOCKET_PATH either:
            // this one only destroys when it's alone, so with two, nothing else would.
            if (server.listenerCount("upgrade") === 1) socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            lastHeard.set(ws, Date.now());
            ws.on("close", () => lastHeard.delete(ws));
            onConnection(ws, () => lastHeard.set(ws, Date.now()), presenceReset);
        });
    });

    const sweep = setInterval(() => {
        const cutoff = Date.now() - IDLE_MS;
        for (const [ws, at] of lastHeard) if (at < cutoff) ws.terminate();
    }, GEO_SOCKET_PING_SECONDS * 1000);
    sweep.unref();
}

function onConnection(ws: WebSocket, heard: () => void, presenceReset: Promise<void>) {
    let playerId: string | null = null;
    /** A token being checked: other `auth` messages meanwhile are ignored. */
    let checking = false;
    const connection: socketHub.GeoSocketConnection = {
        send: (text) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return ws.terminate();
            ws.send(text);
        },
        close: (code, reason) => ws.close(code, reason),
    };
    const send = (message: GeoSocketServerMessage) => connection.send(JSON.stringify(message));
    const authTimer = setTimeout(() => ws.close(GEO_SOCKET_CLOSE.authTimeout, "No auth"), GEO_SOCKET_AUTH_SECONDS * 1000);
    let reauthTimer: NodeJS.Timeout | undefined;
    let expiryTimer: NodeJS.Timeout | undefined;

    ws.on("message", (data, isBinary) => {
        heard();
        if (isBinary) return ws.close(1003, "Text only");
        const text = data.toString();
        if (text === GEO_SOCKET_PING) return connection.send(GEO_SOCKET_PONG);
        if (checking) return;
        checking = true;
        void onAuth(text)
            .catch((error: unknown) => {
                console.error("geo socket: sign-in failed", error);
                ws.close(1011, "Server error");
            })
            .finally(() => {
                checking = false;
            });
    });

    ws.on("close", () => {
        clearTimeout(authTimer);
        clearTimeout(reauthTimer);
        clearTimeout(expiryTimer);
        if (playerId) socketHub.unregister(playerId, connection);
    });
    ws.on("error", (error) => console.error("geo socket: error", error));

    /** The token runs out: ask for a fresh one a little before, and close if none came, so the app comes back with one. */
    function armExpiry(token: string) {
        clearTimeout(reauthTimer);
        clearTimeout(expiryTimer);
        const exp = (jwt.decode(token) as { exp?: number } | null)?.exp;
        if (!exp) return;
        const ms = exp * 1000 - Date.now();
        reauthTimer = setTimeout(() => send({ type: "reauth" }), Math.min(MAX_TIMER_MS, Math.max(0, ms - GEO_SOCKET_REAUTH_SECONDS * 1000)));
        expiryTimer = setTimeout(() => ws.close(GEO_SOCKET_CLOSE.unauthorized, "Token expired"), Math.min(MAX_TIMER_MS, Math.max(0, ms)));
    }

    /** `auth`: signs in, or once signed in, takes a fresh token for the same player. */
    async function onAuth(text: string) {
        let message: Partial<GeoSocketAuthMessage>;
        try {
            message = JSON.parse(text) as Partial<GeoSocketAuthMessage>;
        } catch {
            message = {};
        }
        if (message.type !== "auth" || typeof message.token !== "string") {
            // Signed in: nothing else is ours to read.
            if (playerId) return;
            return ws.close(GEO_SOCKET_CLOSE.unauthorized, "Invalid token");
        }
        const token = message.token;
        let id: string;
        try {
            id = verifyAccessToken(token).playerId;
        } catch {
            return ws.close(GEO_SOCKET_CLOSE.unauthorized, "Invalid token");
        }
        if (playerId && id !== playerId) return ws.close(GEO_SOCKET_CLOSE.unauthorized, "Not your socket");
        // As geoAuth: the player is read, so a ban counts at once.
        const [row] = await query<AccessRow>(`SELECT banned_at FROM geo.players WHERE id = $1`, [id]);
        if (!row) return ws.close(GEO_SOCKET_CLOSE.unauthorized, "Invalid token");
        if (row.banned_at) return ws.close(GEO_SOCKET_CLOSE.banned, "Suspended");
        if (playerId) {
            if (ws.readyState === WebSocket.OPEN) armExpiry(token);
            return;
        }
        await presenceReset;
        if (ws.readyState !== WebSocket.OPEN) return;

        clearTimeout(authTimer);
        playerId = id;
        armExpiry(token);
        // Registered before the snapshots are read, so nothing changed in between is missed.
        socketHub.register(id, connection);
        send({ type: "ready" });
        // Badges and the lobby carry no version: they go out in order with their pushes.
        pushBadges(id);
        pushOwnLobby(id);
        const dungeonRun = await findActiveView(query, id);
        if (dungeonRun) send({ type: "dungeonRun", dungeonRun });
        const run = await findRecentSharedRun(id);
        if (run) send({ type: "run", run });
    }
}
