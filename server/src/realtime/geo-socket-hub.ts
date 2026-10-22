import type { GeoSocketServerMessage, GeoSocketTopic } from "@geo/shared";

/**
 * Who's connected, and sending them pushes. Knows nothing about how a socket
 * is carried: `geo-socket.ts` plugs Node's `ws` in here; on Cloudflare, the
 * Durable Object would register its own sockets the same way.
 *
 * In memory, for this one process. Pushes are a courtesy: a player who
 * misses one gets the truth on their next read or reconnect.
 *
 * Presence is not: shared-fight turn clocks and dungeon holds read
 * `offlineSince`, so a player this process can't see counts as gone and
 * loses turns. The geo backend must run as ONE process (or one Durable
 * Object); a second server would need presence moved somewhere shared first.
 */

/** One open socket. */
export type GeoSocketConnection = {
    send(text: string): void;
    close(code: number, reason: string): void;
};

const connections = new Map<string, Set<GeoSocketConnection>>();
/** When each player's last socket closed (ms). */
const lastSeen = new Map<string, number>();
/** Each player's last signed-in HTTP request (ms): someone playing without a socket isn't gone. */
const lastRequest = new Map<string, number>();
/** Players never connected to this process count as offline since it started. */
const STARTED_AT = Date.now();
type PresenceListener = (playerId: string) => void;
const offlineListeners = new Set<PresenceListener>();
const onlineListeners = new Set<PresenceListener>();

/**
 * A last socket closing waits this long before the player counts as gone,
 * so a reconnect (a fresh token, a blip in signal) isn't an offline and
 * online again for their friends, turn clock and party.
 */
export const OFFLINE_GRACE_MS = 10_000;
/** Players whose last socket closed within the grace: when it closed, and the timer that makes it count. */
const leaving = new Map<string, { at: number; timer: NodeJS.Timeout }>();

/** Calls `listener` whenever a player goes offline: their last socket closed, and the grace ran out. */
export function onOffline(listener: PresenceListener): () => void {
    offlineListeners.add(listener);
    return () => offlineListeners.delete(listener);
}

/** Calls `listener` whenever an offline player opens a socket (signed in). */
export function onOnline(listener: PresenceListener): () => void {
    onlineListeners.add(listener);
    return () => onlineListeners.delete(listener);
}

function tell(listeners: Set<PresenceListener>, playerId: string) {
    for (const listener of listeners) {
        try {
            listener(playerId);
        } catch (error) {
            console.error("geo socket: presence listener failed", error);
        }
    }
}

/**
 * Since when the player has been gone (ms), or null while they're here: a
 * socket open, or one closed within the grace. Counts from when the socket
 * closed, or their last request if that was later.
 */
export function offlineSince(playerId: string): number | null {
    if (connections.has(playerId) || leaving.has(playerId)) return null;
    return Math.max(lastSeen.get(playerId) ?? STARTED_AT, lastRequest.get(playerId) ?? 0);
}

/** A signed-in HTTP request from the player (`geoAuth`). */
export function heardFrom(playerId: string) {
    lastRequest.set(playerId, Date.now());
}

/** A player can have several (two phones); each gets every push. */
export function register(playerId: string, connection: GeoSocketConnection) {
    let mine = connections.get(playerId);
    const back = leaving.get(playerId);
    if (back) {
        clearTimeout(back.timer);
        leaving.delete(playerId);
    }
    const cameOnline = !mine && !back;
    if (!mine) connections.set(playerId, (mine = new Set()));
    mine.add(connection);
    lastSeen.delete(playerId);
    if (cameOnline) tell(onlineListeners, playerId);
}

export function unregister(playerId: string, connection: GeoSocketConnection) {
    const mine = connections.get(playerId);
    if (!mine?.delete(connection) || mine.size > 0) return;
    connections.delete(playerId);
    const at = Date.now();
    const timer = setTimeout(() => {
        leaving.delete(playerId);
        lastSeen.set(playerId, at);
        tell(offlineListeners, playerId);
    }, OFFLINE_GRACE_MS);
    timer.unref();
    leaving.set(playerId, { at, timer });
}

/** Every player with a socket open here. */
export function connectedPlayers(): string[] {
    return [...connections.keys()];
}

export function isConnected(playerId: string): boolean {
    return connections.has(playerId);
}

/** Closes every socket the player has open here (a ban). */
export function disconnect(playerId: string, code: number, reason: string) {
    for (const connection of connections.get(playerId) ?? []) connection.close(code, reason);
}

/** Sends to every socket the player has open; nothing if none. */
export function publish(playerId: string, message: GeoSocketServerMessage) {
    const mine = connections.get(playerId);
    if (!mine) return;
    const text = JSON.stringify(message);
    for (const connection of mine) {
        try {
            connection.send(text);
        } catch (error) {
            console.error("geo socket: send failed", error);
        }
    }
}

/** Sends to every socket open here. */
export function broadcast(message: GeoSocketServerMessage) {
    for (const playerId of connections.keys()) publish(playerId, message);
}

type Read = () => Promise<GeoSocketServerMessage | null>;
/** Per player and kind: a fresh push going out, and the read to run again after it, if asked meanwhile. */
const freshPushes = new Map<string, { read: Read; again: boolean }>();

/**
 * Pushes the player something read fresh (their lobby, their badges), for
 * state with no version to order it by. One read at a time per player and
 * `kind`, each after the last went out, so an older read can't land after
 * a newer one; asks while one runs fold into one more read after it.
 */
export function pushFresh(playerId: string, kind: string, read: Read) {
    if (!connections.has(playerId)) return;
    const key = `${kind}:${playerId}`;
    const running = freshPushes.get(key);
    if (running) {
        running.read = read;
        running.again = true;
        return;
    }
    const entry = { read, again: false };
    freshPushes.set(key, entry);
    void (async () => {
        do {
            entry.again = false;
            try {
                const message = await entry.read();
                if (message) publish(playerId, message);
            } catch (error) {
                console.error(`geo socket: ${kind} push failed`, error);
            }
        } while (entry.again);
        freshPushes.delete(key);
    })();
}

/** A burst of changes (a run of auctions settling) goes out as one hint. */
const HINT_COALESCE_MS = 250;
const pendingHints = new Set<GeoSocketTopic>();

/**
 * Tells everyone something shared changed (the Market, the election), so
 * an open screen reads it again. Hints in the same instant go out once.
 */
export function broadcastChanged(topic: GeoSocketTopic) {
    if (pendingHints.has(topic)) return;
    pendingHints.add(topic);
    setTimeout(() => {
        pendingHints.delete(topic);
        broadcast({ type: "changed", topic });
    }, HINT_COALESCE_MS).unref();
}
