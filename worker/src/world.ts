import { DurableObject } from "cloudflare:workers";
import { createApp, type World as WorldState } from "./app";
import { Db } from "./db/db";
import { migrate } from "./db/schema";
import type { Env } from "./env";
import { bookRecurringJobs, runDueJobs } from "./jobs";
import { nextDue } from "./modules/jobs/jobs.repository";
import { createHub } from "./realtime/hub";

/**
 * The World: one Durable Object holding the whole game's SQLite database.
 * It handles one request at a time, so a synchronous transaction is all the
 * locking the game needs (no `FOR UPDATE`, no lock order).
 *
 * It keeps one alarm, at the soonest row of the `due` table (src/jobs.ts),
 * re-armed after every request and alarm, and only when that time moved:
 * setting it is a write.
 */
export class World extends DurableObject<Env> {
    readonly db: Db;
    /** What routes see: the database, settings, and what's kept in memory. */
    readonly state: WorldState;
    private readonly app: ReturnType<typeof createApp>;
    /** When the alarm is set for, as far as this instance knows; null for none. */
    private armedAt: number | null = null;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.db = new Db(ctx.storage);
        this.state = { db: this.db, env, lastHeard: new Map(), travel: new Map(), hub: createHub() };
        this.app = createApp(this.state);
        // Nothing is served until the schema is current and the clock is set.
        void ctx.blockConcurrencyWhile(async () => {
            migrate(this.db);
            bookRecurringJobs(this.state);
            this.armedAt = await ctx.storage.getAlarm();
            this.rearm();
        });
    }

    override async fetch(request: Request): Promise<Response> {
        const response = await this.app.fetch(request);
        this.rearm();
        return response;
    }

    override alarm() {
        // Going off cleared it.
        this.armedAt = null;
        runDueJobs(this.state);
        this.rearm();
    }

    /**
     * Points the alarm at the soonest due row, if that isn't where it points.
     * Synchronous from the read to the set, so two requests can't interleave
     * and leave it at the later of two times.
     */
    private rearm() {
        const next = nextDue(this.db);
        if (next === this.armedAt) return;
        this.armedAt = next;
        if (next === null) void this.ctx.storage.deleteAlarm();
        else void this.ctx.storage.setAlarm(next);
    }
}
