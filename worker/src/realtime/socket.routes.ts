import { Hono } from "hono";
import { GEO_SOCKET_PATH } from "@geo/shared";
import type { AppEnv } from "../app";
import { rateLimit } from "../http/rate-limit";

/**
 * The geo socket's upgrade: the World keeps the server end (hibernating,
 * realtime/hub.ts) and the client gets the other. The socket signs in with
 * its first message, not here, as on the Express server.
 */
export const socketRoutes = new Hono<AppEnv>();

/** An app reconnecting in a loop: a reconnect every couple of seconds per address is plenty. */
const upgradeLimit = rateLimit({ windowMs: 60_000, max: 30, message: "Too many reconnects. Wait a minute and try again." });

socketRoutes.get(GEO_SOCKET_PATH, upgradeLimit, (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return c.json({ error: "Expected a WebSocket upgrade" }, 426);
    const [client, server] = Object.values(new WebSocketPair());
    c.var.world.hub.accept(server!);
    return new Response(null, { status: 101, webSocket: client });
});
