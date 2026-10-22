import type { GeoDungeonLobby, GeoDungeonRunView } from "./dungeon.contract";
import type { GeoBadges } from "./friends.contract";
import type { GeoRunResponse } from "./run.contract";

/**
 * The geo socket: one WebSocket per open app, for what other players change
 * (a party's map, the lobby you wait in, the Market). It only pushes. Everything a player
 * does still goes over HTTP, checked and saved there; once it's saved, the
 * server pushes each player concerned their own view of the result.
 *
 * Built to run unchanged on a Cloudflare Durable Object with hibernation:
 * plain WebSocket text frames, JSON messages, and the client sends only two
 * things: `auth` (first, and again with a fresh token when asked), and the
 * bare text `ping` (answered `pong` without waking anything up). No state lives only in a socket: on every (re)connect
 * the server sends fresh snapshots, so a missed push is never lost for long.
 */

/** Same host and port as the API, `ws(s)://` instead of `http(s)://`. */
export const GEO_SOCKET_PATH = "/geo/socket";

/** The client's keep-alive text, and the server's answer. Bare text, not JSON. */
export const GEO_SOCKET_PING = "ping";
export const GEO_SOCKET_PONG = "pong";
/** How often the client pings. Under the 60 s idle timeout of common proxies. */
export const GEO_SOCKET_PING_SECONDS = 25;
/** No pong for this long after a ping: the connection is dead; reconnect. */
export const GEO_SOCKET_PONG_TIMEOUT_SECONDS = 10;
/** A socket that hasn't sent `auth` by now is closed. */
export const GEO_SOCKET_AUTH_SECONDS = 10;
/** This long before the token runs out, the server sends `reauth`. */
export const GEO_SOCKET_REAUTH_SECONDS = 120;

/**
 * Close codes the client acts on. `unauthorized`: the token was bad or ran
 * out; get a new one, then reconnect. `banned`: don't reconnect.
 */
export const GEO_SOCKET_CLOSE = {
    unauthorized: 4401,
    banned: 4403,
    authTimeout: 4408,
} as const;

/**
 * Client → server, first: the same access token the API takes. Sent again
 * on the open socket after a `reauth`, with a fresh token for the same
 * player, it keeps the socket open past the old token's expiry.
 */
export type GeoSocketAuthMessage = { type: "auth"; token: string };

/**
 * Server → client.
 * - `ready`: signed in. The snapshots follow at once.
 * - `reauth`: your token runs out in GEO_SOCKET_REAUTH_SECONDS; get a fresh
 *   one and send `auth` again. Without it, the socket closes `unauthorized`
 *   when the token runs out.
 * - `lobby`: the dungeon lobby you're in, or null once you're not (you left,
 *   it closed, or it started: a `dungeonRun` push follows).
 * - `dungeonRun`: your dungeon run as you may see it, after anyone in the
 *   party changed it. Older than the one you hold (by `version`)? Drop it.
 * - `badges`: the HUD's counts (friend requests, unread mail, chests), on
 *   connect and whenever one changes.
 * - `changed`: something you see changed (`topic`); a screen showing
 *   it reads it again over HTTP. Also worth a read after any reconnect,
 *   since hints sent while you were away are gone.
 * - `run`: a shared fight moved on without you acting (a teammate's turn,
 *   a skipped turn): your view and what happened, to play like your own.
 *   Also by `version`. On (re)connect, your shared fight if it's going or
 *   just ended, with an empty log: what you missed, as it stands now.
 */
export type GeoSocketServerMessage =
    | { type: "ready" }
    | { type: "reauth" }
    | { type: "lobby"; lobby: GeoDungeonLobby | null }
    | { type: "dungeonRun"; dungeonRun: GeoDungeonRunView }
    | { type: "badges"; badges: GeoBadges }
    | { type: "changed"; topic: GeoSocketTopic }
    | { type: "run"; run: GeoRunResponse };

/**
 * What a `changed` hint is about: the Market (listings, bids, sales) and the
 * mayor and election, sent to everyone; your friends list (a friend's
 * status, a request or friendship of yours), sent to you.
 */
export type GeoSocketTopic = "market" | "mayor" | "friends";
