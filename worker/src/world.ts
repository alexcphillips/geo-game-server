import { DurableObject } from "cloudflare:workers";
import { GEO_SOCKET_PING, GEO_SOCKET_PONG } from "@geo/shared";
import { createApp, type World as WorldState } from "./app";
import { Db } from "./db/db";
import { migrate } from "./db/schema";
import type { Env } from "./env";
import { bookRecurringJobs, runDueJobs } from "./jobs";
import { verifyAccessToken } from "./lib/tokens";
import { countBadges } from "./modules/friends/friends.repository";
import { nextDue } from "./modules/jobs/jobs.repository";
import { createHub, type SocketHub } from "./realtime/hub";
import { cameOnline, goneSince, snapshotsFor, socketAccess, wentOffline } from "./realtime/presence";

/**
 * The World: one Durable Object holding the whole game's SQLite database.
 * It handles one request at a time, so a synchronous transaction is all the
 * locking the game needs (no `FOR UPDATE`, no lock order).
 *
 * It keeps one alarm, at the soonest row of the `due` table (src/jobs.ts) or
 * the sockets' next hourly timer (realtime/hub.ts), whichever comes first,
 * re-armed after every request, socket event and alarm, and only when that
 * time moved: setting it is a write.
 *
 * Its sockets hibernate (realtime/hub.ts): the World can leave memory with
 * them open, and starts again (this constructor) for their next message.
 */
export class World extends DurableObject<Env> {
    readonly db: Db;
    /** What routes see: the database, settings, and what's kept in memory. */
    readonly state: WorldState;
    readonly hub: SocketHub;
    private readonly app: ReturnType<typeof createApp>;
    /** When the alarm is set for, as far as this instance knows; null for none. */
    private armedAt: number | null = null;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.db = new Db(ctx.storage);
        const lastHeard = new Map<string, number>();
        // The hooks read `this.state` when called, after it's set below.
        this.hub = createHub(ctx, lastHeard, {
            verify: (token) => verifyAccessToken(env.GEO_JWT_SECRET, token),
            access: (playerId) => socketAccess(this.state, playerId),
            snapshots: (playerId) => snapshotsFor(this.state, playerId),
            badges: (playerId) => countBadges(this.db, playerId),
            online: (playerId) => cameOnline(this.state, playerId),
            offline: (playerId, since) => wentOffline(this.state, playerId, since),
            goneSince: (playerId) => goneSince(this.state, playerId),
            changed: () => this.rearm(),
        });
        this.state = { db: this.db, env, lastHeard, travel: new Map(), hub: this.hub };
        this.app = createApp(this.state);
        // Pings never wake the World (nor count as requests).
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(GEO_SOCKET_PING, GEO_SOCKET_PONG));
        // Nothing is served until the schema is current and the clock is set.
        void ctx.blockConcurrencyWhile(async () => {
            migrate(this.db);
            bookRecurringJobs(this.state);
            this.armedAt = await ctx.storage.getAlarm();
            this.rearm();
        });
    }

    override async fetch(request: Request): Promise<Response> {
        this.hub.sweep();
        const response = await this.app.fetch(request);
        // A body nobody read (refused before it was needed) is drained, or the runtime throws on the request stream.
        if (request.body && !request.bodyUsed) await request.arrayBuffer().catch(() => {});
        this.rearm();
        return response;
    }

    override alarm() {
        // Going off cleared it.
        this.armedAt = null;
        this.hub.sweep();
        runDueJobs(this.state);
        this.rearm();
    }

    override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        this.hub.sweep();
        await this.hub.message(ws, message);
    }

    override webSocketClose(ws: WebSocket, code: number, reason: string) {
        this.hub.closed(ws);
        try {
            // Answers the other side's close (a no-op where the runtime already has).
            ws.close(code === 1005 ? 1000 : code, reason);
        } catch {
            // Already closed.
        }
    }

    override webSocketError(ws: WebSocket) {
        this.hub.closed(ws);
    }

    /**
     * Points the alarm at the soonest due row or socket timer, if that isn't
     * where it points. Synchronous from the read to the set, so two requests
     * can't interleave and leave it at the later of two times.
     */
    private rearm() {
        const due = nextDue(this.db);
        const sockets = this.hub.nextWake();
        const next = due === null ? sockets : sockets === null ? due : Math.min(due, sockets);
        if (next === this.armedAt) return;
        this.armedAt = next;
        if (next === null) void this.ctx.storage.deleteAlarm();
        else void this.ctx.storage.setAlarm(next);
    }
}
