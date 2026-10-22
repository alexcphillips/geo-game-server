import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../../server/src/http/AppError";
import type { GeoRole } from "@geo/shared";
import type { Db } from "./db/db";
import type { Env } from "./env";
import { accountsRoutes } from "./modules/accounts/accounts.routes";
import { placesRoutes } from "./modules/places/places.routes";
import { playerRoutes } from "./modules/player/player.routes";
import { wardrobeRoutes } from "./modules/wardrobe/wardrobe.routes";
import type { TravelMemory } from "./modules/world/world.types";
import { worldRoutes } from "./modules/world/world.routes";

/**
 * What every route can reach: the World's database, the Worker's settings,
 * and what the World keeps in memory instead of writing rows (forgotten on
 * a restart, which costs nothing that matters).
 */
export type World = {
    db: Db;
    env: Env;
    /** When each player was last heard from (any signed-in request): presence. */
    lastHeard: Map<string, number>;
    /** Each player's last point and walked distance, for spawns (world/travel.ts). */
    travel: Map<string, TravelMemory>;
};
export type AppEnv = { Variables: { world: World; playerId?: string; role?: GeoRole } };

/**
 * The API, mounted in the World object. Routes and their paths are the same
 * as the Express server's (`GEO_API_PATHS`), module by module as they move.
 */
export function createApp(world: World) {
    const app = new Hono<AppEnv>();

    app.use(async (c, next) => {
        c.set("world", world);
        await next();
    });

    app.route("/", accountsRoutes);
    app.route("/", playerRoutes);
    app.route("/", wardrobeRoutes);
    app.route("/", worldRoutes);
    app.route("/", placesRoutes);

    app.notFound((c) => c.json({ error: `No route for ${c.req.method} ${new URL(c.req.url).pathname}` }, 404));

    // The single place an error becomes a response. Anything that isn't an
    // AppError is a bug: logged in full, answered with a bare 500.
    app.onError((error, c) => {
        if (error instanceof AppError) {
            if (error.retryAfterSeconds !== undefined) c.header("Retry-After", String(error.retryAfterSeconds));
            return c.json({ error: error.message }, error.status as ContentfulStatusCode);
        }
        console.error("Unhandled error:", error);
        return c.json({ error: "Internal server error" }, 500);
    });

    return app;
}
