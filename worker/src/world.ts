import { DurableObject } from "cloudflare:workers";
import { createApp } from "./app";
import { Db } from "./db/db";
import { migrate } from "./db/schema";
import type { Env } from "./env";

/**
 * The World: one Durable Object holding the whole game's SQLite database.
 * It handles one request at a time, so a synchronous transaction is all the
 * locking the game needs (no `FOR UPDATE`, no lock order).
 */
export class World extends DurableObject<Env> {
    readonly db: Db;
    private readonly app: ReturnType<typeof createApp>;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.db = new Db(ctx.storage);
        // Nothing is served until the schema is current.
        ctx.blockConcurrencyWhile(async () => migrate(this.db));
        this.app = createApp({ db: this.db, env });
    }

    override fetch(request: Request): Promise<Response> {
        return Promise.resolve(this.app.fetch(request));
    }
}
