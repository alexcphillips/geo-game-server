import {
    GEO_SOCKET_AUTH_SECONDS,
    GEO_SOCKET_CLOSE,
    GEO_SOCKET_PING,
    GEO_SOCKET_PING_SECONDS,
    GEO_SOCKET_PONG,
    GEO_SOCKET_REAUTH_SECONDS,
    type GeoActivity,
    type GeoBadges,
    type GeoSocketAuthMessage,
    type GeoSocketServerMessage,
    type GeoSocketTopic,
} from "@geo/shared";

/**
 * The geo socket on the World object: server/src/realtime/geo-socket.ts and
 * geo-socket-hub.ts, with Cloudflare's hibernating WebSockets. The protocol
 * is `realtime.contract.ts`, unchanged.
 *
 * Hibernation: while nobody does anything, the World leaves memory and its
 * sockets stay open; the next message, close or alarm starts it again. So
 * what a socket must remember (whose it is, when its token runs out, what
 * the player is doing) is its attachment, and the map of who's connected is
 * rebuilt from those when the World starts. `ping` is answered by the
 * runtime (setWebSocketAutoResponse) without waking anything.
 *
 * Timers: the short ones (the sign-in wait, the offline grace, coalescing
 * a burst of pushes) are in memory, and keep the World awake the few
 * seconds they run; one object can't go over the free plan's duration
 * anyway. The hourly ones (`reauth`, then closing on an expired token) are
 * the alarm's (`nextWake`, rounded up to the minute so sockets share it):
 * setting the alarm is a row written. A silent socket (no ping for two
 * pings and a bit) is closed whenever the World next does anything
 * (`sweep`), which is before anything reads presence.
 */

/** Silent this long (no ping, nothing): the phone is gone without saying so. Two missed pings and a bit. */
export const IDLE_MS = (GEO_SOCKET_PING_SECONDS * 2 + 10) * 1000;
/**
 * A last socket closing waits this long before the player counts as gone,
 * so a reconnect (a fresh token, a blip in signal) isn't an offline and
 * online again for their friends, turn clock and party.
 */
export const OFFLINE_GRACE_MS = 10_000;
const AUTH_MS = GEO_SOCKET_AUTH_SECONDS * 1000;
const REAUTH_MS = GEO_SOCKET_REAUTH_SECONDS * 1000;
/** auth is a token and a few bytes; anything big is not ours. */
const MAX_MESSAGE_CHARS = 8 * 1024;
/** A burst of changes (a run of mail, of auctions settling) goes out as one push. */
const COALESCE_MS = 250;
/** The hourly timers share alarms by the minute. */
const WAKE_STEP_MS = 60_000;
/** WebSocket.readyState while open. */
const OPEN = 1;

export type Activity = { activity: GeoActivity; skill: string | null };

/** What a socket carries through hibernation (at most 16 KB). */
type Attachment = {
    openedAt: number;
    /** Null until it signs in. */
    playerId: string | null;
    /** When the token it signed in with runs out (ms). */
    expiresAt: number | null;
    reauthSent: boolean;
    activity: Activity | null;
};

/** What the hub needs from the rest of the World. */
export type HubHooks = {
    /** The token's player and expiry; throws on a bad token. */
    verify(token: string): Promise<{ playerId: string; expiresAt: number }>;
    /** Whether the player may have a socket, read now, so a ban counts at once. */
    access(playerId: string): "ok" | "banned" | "unknown";
    /** On sign-in, after `ready`: badges, their lobby, their dungeon run and shared fight. */
    snapshots(playerId: string): GeoSocketServerMessage[];
    badges(playerId: string): GeoBadges;
    /** An offline player opened a socket. */
    online(playerId: string): void;
    /** A player's last socket closed (at `since`) and the grace ran out. */
    offline(playerId: string, since: number): void;
    /** When the player went, if that was saved (they dropped mid-party): memory is lost when the World hibernates. */
    goneSince(playerId: string): number | null;
    /** Something the alarm depends on moved (a socket's token): the World re-arms. */
    changed(): void;
};

/** Who's connected, and pushes to them, as the World's modules see it. */
export type Hub = {
    /** Since when the player has been gone (ms), or null while they're here (or within the grace). */
    offlineSince(playerId: string): number | null;
    isConnected(playerId: string): boolean;
    /** Sends to every socket the player has open; nothing if none. */
    publish(playerId: string, message: GeoSocketServerMessage): void;
    /** The HUD's badge counts changed for these players (or everyone): fresh counts go out. */
    badgesChanged(playerIds: string[] | "everyone"): void;
    /** Something shared changed (the Market, the election): every open screen of it reads again. */
    broadcastChanged(topic: GeoSocketTopic): void;
    /** What the player is doing while here ("exploring" until their app says), or null when gone. */
    activityOf(playerId: string): Activity | null;
    /** From their app. False, and ignored, without a socket: they're offline. */
    setActivity(playerId: string, activity: Activity): boolean;
    /** Closes every socket the player has open (a ban). */
    disconnect(playerId: string, code: number, reason: string): void;
};

/** What the World object itself calls. */
export type SocketHub = Hub & {
    /** A new socket from an upgrade, before it has said anything. */
    accept(ws: WebSocket): void;
    message(ws: WebSocket, data: string | ArrayBuffer): Promise<void>;
    closed(ws: WebSocket): void;
    /** Closes silent and expired sockets, sends due `reauth`s, ends lapsed graces. On every request and alarm. */
    sweep(now?: number): void;
    /** When the alarm must go off for the sockets' hourly timers, or null. */
    nextWake(): number | null;
};

/**
 * `lastHeard`: each player's last signed-in HTTP request (World memory):
 * someone playing without a socket isn't gone.
 */
export function createHub(ctx: DurableObjectState, lastHeard: Map<string, number>, hooks: HubHooks): SocketHub {
    /** Players never seen by this instance (and not saved as gone) count as gone since it started. */
    const startedAt = Date.now();
    const connections = new Map<string, Set<WebSocket>>();
    /** When each player's last socket closed (ms). */
    const lastSeen = new Map<string, number>();
    /** Players whose last socket closed within the grace: when, and the timer that makes it count. */
    const leaving = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>();
    /** Each socket's last message (memory only; after a wake the attachment's openedAt and the last ping stand in). */
    const lastMessage = new WeakMap<WebSocket, number>();
    /** Sockets being signed in: another `auth` meanwhile is ignored. */
    const checking = new WeakSet<WebSocket>();
    /** Closed by us: the runtime may still list them until the other side answers. */
    const shut = new WeakSet<WebSocket>();
    const pendingBadges = new Set<string>();
    let badgeTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingTopics = new Set<GeoSocketTopic>();
    let topicTimer: ReturnType<typeof setTimeout> | null = null;

    const read = (ws: WebSocket) => ws.deserializeAttachment() as Attachment | null;
    const write = (ws: WebSocket, attachment: Attachment) => ws.serializeAttachment(attachment);

    function send(ws: WebSocket, text: string) {
        if (ws.readyState !== OPEN || shut.has(ws)) return;
        try {
            ws.send(text);
        } catch (error) {
            console.error("geo socket: send failed", error);
        }
    }

    function close(ws: WebSocket, code: number, reason: string, at = Date.now()) {
        if (shut.has(ws)) return;
        shut.add(ws);
        try {
            ws.close(code, reason);
        } catch {
            // A code the runtime won't send, or already closing.
            try {
                ws.close(1000, reason);
            } catch {
                // Already closing.
            }
        }
        unregister(ws, at);
    }

    /** True if the player was offline: the caller tells `online` once the socket has its snapshots. */
    function register(playerId: string, ws: WebSocket): boolean {
        let mine = connections.get(playerId);
        const back = leaving.get(playerId);
        if (back) {
            clearTimeout(back.timer);
            leaving.delete(playerId);
        }
        const cameOnline = !mine && !back;
        if (!mine) connections.set(playerId, (mine = new Set()));
        mine.add(ws);
        lastSeen.delete(playerId);
        return cameOnline;
    }

    /** `at`: when the socket was last alive (a silent one died before it was noticed). */
    function unregister(ws: WebSocket, at: number) {
        const playerId = read(ws)?.playerId;
        const mine = playerId ? connections.get(playerId) : undefined;
        if (!playerId || !mine?.delete(ws) || mine.size > 0) return;
        connections.delete(playerId);
        const wait = Math.max(0, at + OFFLINE_GRACE_MS - Date.now());
        leaving.set(playerId, { at, timer: setTimeout(() => wentOffline(playerId), wait) });
    }

    function wentOffline(playerId: string) {
        const gone = leaving.get(playerId);
        if (!gone) return;
        clearTimeout(gone.timer);
        leaving.delete(playerId);
        lastSeen.set(playerId, gone.at);
        tell(() => hooks.offline(playerId, gone.at));
    }

    function tell(hook: () => void) {
        try {
            hook();
        } catch (error) {
            console.error("geo socket: presence hook failed", error);
        }
        hooks.changed();
    }

    /** When the socket was last heard from: its last message, its last ping, or when it opened. */
    function heardAt(ws: WebSocket, attachment: Attachment): number {
        const ping = ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
        return Math.max(attachment.openedAt, lastMessage.get(ws) ?? 0, ping);
    }

    function closeIfNotSignedIn(ws: WebSocket) {
        if (ws.readyState === OPEN && read(ws)?.playerId === null) close(ws, GEO_SOCKET_CLOSE.authTimeout, "No auth");
    }

    function waitForAuth(ws: WebSocket, openedAt: number) {
        setTimeout(() => closeIfNotSignedIn(ws), Math.max(0, openedAt + AUTH_MS - Date.now()));
    }

    // Started (again): who's connected is in the sockets themselves.
    for (const ws of ctx.getWebSockets()) {
        const attachment = read(ws);
        if (!attachment || ws.readyState !== OPEN) continue;
        if (attachment.playerId) {
            let mine = connections.get(attachment.playerId);
            if (!mine) connections.set(attachment.playerId, (mine = new Set()));
            mine.add(ws);
        } else {
            waitForAuth(ws, attachment.openedAt);
        }
    }

    function sockets(playerId: string): WebSocket[] {
        return [...(connections.get(playerId) ?? [])];
    }

    function publish(playerId: string, message: GeoSocketServerMessage) {
        const mine = connections.get(playerId);
        if (!mine) return;
        const text = JSON.stringify(message);
        for (const ws of mine) send(ws, text);
    }

    /** `auth`: signs in, or once signed in, takes a fresh token for the same player. */
    async function onAuth(ws: WebSocket, text: string) {
        let message: Partial<GeoSocketAuthMessage>;
        try {
            message = JSON.parse(text) as Partial<GeoSocketAuthMessage>;
        } catch {
            message = {};
        }
        const signedIn = read(ws)?.playerId ?? null;
        if (message.type !== "auth" || typeof message.token !== "string") {
            // Signed in: nothing else is ours to read.
            if (signedIn) return;
            return close(ws, GEO_SOCKET_CLOSE.unauthorized, "Invalid token");
        }
        let token: { playerId: string; expiresAt: number };
        try {
            token = await hooks.verify(message.token);
        } catch {
            return close(ws, GEO_SOCKET_CLOSE.unauthorized, "Invalid token");
        }
        if (ws.readyState !== OPEN || shut.has(ws)) return;
        if (signedIn && token.playerId !== signedIn) return close(ws, GEO_SOCKET_CLOSE.unauthorized, "Not your socket");
        const access = hooks.access(token.playerId);
        if (access === "unknown") return close(ws, GEO_SOCKET_CLOSE.unauthorized, "Invalid token");
        if (access === "banned") return close(ws, GEO_SOCKET_CLOSE.banned, "Suspended");

        const attachment = read(ws)!;
        if (signedIn) {
            write(ws, { ...attachment, expiresAt: token.expiresAt, reauthSent: false });
            hooks.changed();
            return;
        }
        const playerId = token.playerId;
        const activity = sockets(playerId).map((other) => read(other)?.activity).find(Boolean) ?? null;
        write(ws, { ...attachment, playerId, expiresAt: token.expiresAt, reauthSent: false, activity });
        // Registered before the snapshots are read; nothing can change in between anyway (no await).
        const cameOnline = register(playerId, ws);
        send(ws, JSON.stringify({ type: "ready" } satisfies GeoSocketServerMessage));
        try {
            for (const snapshot of hooks.snapshots(playerId)) send(ws, JSON.stringify(snapshot));
        } catch (error) {
            console.error("geo socket: snapshots failed", error);
        }
        if (cameOnline) tell(() => hooks.online(playerId));
        else hooks.changed();
    }

    return {
        offlineSince(playerId) {
            if (connections.has(playerId) || leaving.has(playerId)) return null;
            return Math.max(lastSeen.get(playerId) ?? hooks.goneSince(playerId) ?? startedAt, lastHeard.get(playerId) ?? 0);
        },

        isConnected: (playerId) => connections.has(playerId),

        publish,

        badgesChanged(playerIds) {
            for (const id of playerIds === "everyone" ? connections.keys() : playerIds) {
                if (connections.has(id)) pendingBadges.add(id);
            }
            if (badgeTimer || pendingBadges.size === 0) return;
            badgeTimer = setTimeout(() => {
                badgeTimer = null;
                const ids = [...pendingBadges];
                pendingBadges.clear();
                for (const id of ids) {
                    if (!connections.has(id)) continue;
                    try {
                        publish(id, { type: "badges", badges: hooks.badges(id) });
                    } catch (error) {
                        console.error("geo socket: badges push failed", error);
                    }
                }
            }, COALESCE_MS);
        },

        broadcastChanged(topic) {
            pendingTopics.add(topic);
            if (topicTimer) return;
            topicTimer = setTimeout(() => {
                topicTimer = null;
                const topics = [...pendingTopics];
                pendingTopics.clear();
                for (const changed of topics) {
                    const text = JSON.stringify({ type: "changed", topic: changed } satisfies GeoSocketServerMessage);
                    for (const mine of connections.values()) for (const ws of mine) send(ws, text);
                }
            }, COALESCE_MS);
        },

        activityOf(playerId) {
            if (!connections.has(playerId) && !leaving.has(playerId)) return null;
            const mine = sockets(playerId);
            return mine.map((ws) => read(ws)?.activity).find(Boolean) ?? { activity: "exploring", skill: null };
        },

        setActivity(playerId, activity) {
            const mine = sockets(playerId);
            for (const ws of mine) write(ws, { ...read(ws)!, activity });
            return mine.length > 0;
        },

        disconnect(playerId, code, reason) {
            for (const ws of sockets(playerId)) close(ws, code, reason);
        },

        accept(ws) {
            const openedAt = Date.now();
            ctx.acceptWebSocket(ws);
            write(ws, { openedAt, playerId: null, expiresAt: null, reauthSent: false, activity: null });
            waitForAuth(ws, openedAt);
        },

        async message(ws, data) {
            lastMessage.set(ws, Date.now());
            if (typeof data !== "string") return close(ws, 1003, "Text only");
            if (data.length > MAX_MESSAGE_CHARS) return close(ws, 1009, "Too big");
            // The runtime answers pings itself; this is for one that reaches us anyway.
            if (data === GEO_SOCKET_PING) return send(ws, GEO_SOCKET_PONG);
            if (checking.has(ws)) return;
            checking.add(ws);
            try {
                await onAuth(ws, data);
            } catch (error) {
                console.error("geo socket: sign-in failed", error);
                close(ws, 1011, "Server error");
            } finally {
                checking.delete(ws);
            }
        },

        closed(ws) {
            if (shut.has(ws)) return;
            shut.add(ws);
            unregister(ws, Date.now());
        },

        sweep(now = Date.now()) {
            let moved = false;
            for (const mine of [...connections.values()]) {
                for (const ws of [...mine]) {
                    const attachment = read(ws);
                    if (!attachment) continue;
                    const heard = heardAt(ws, attachment);
                    if (attachment.expiresAt !== null && now >= attachment.expiresAt) {
                        close(ws, GEO_SOCKET_CLOSE.unauthorized, "Token expired");
                    } else if (heard < now - IDLE_MS) {
                        close(ws, 1001, "Gone quiet", heard);
                    } else if (attachment.expiresAt !== null && !attachment.reauthSent && now >= attachment.expiresAt - REAUTH_MS) {
                        write(ws, { ...attachment, reauthSent: true });
                        send(ws, JSON.stringify({ type: "reauth" } satisfies GeoSocketServerMessage));
                        moved = true;
                    }
                }
            }
            for (const [playerId, gone] of [...leaving]) if (now >= gone.at + OFFLINE_GRACE_MS) wentOffline(playerId);
            if (moved) hooks.changed();
        },

        nextWake() {
            let soonest: number | null = null;
            for (const mine of connections.values()) {
                for (const ws of mine) {
                    const attachment = read(ws);
                    if (attachment?.expiresAt == null) continue;
                    const at = attachment.reauthSent ? attachment.expiresAt : attachment.expiresAt - REAUTH_MS;
                    if (soonest === null || at < soonest) soonest = at;
                }
            }
            return soonest === null ? null : Math.ceil(soonest / WAKE_STEP_MS) * WAKE_STEP_MS;
        },
    };
}
