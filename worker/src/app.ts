import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../../server/src/http/AppError";
import type { GeoActivity, GeoRole } from "@geo/shared";
import type { Db } from "./db/db";
import type { Env } from "./env";
import { accountsRoutes } from "./modules/accounts/accounts.routes";
import { adminRoutes } from "./modules/admin/admin.routes";
import { chestsRoutes } from "./modules/chests/chests.routes";
import { contentRoutes } from "./modules/content/content.routes";
import { craftingRoutes } from "./modules/crafting/crafting.routes";
import { dungeonRunsRoutes } from "./modules/dungeon-runs/dungeon-runs.routes";
import { dungeonsRoutes } from "./modules/dungeons/dungeons.routes";
import { farmingRoutes } from "./modules/farming/farming.routes";
import { feedbackRoutes } from "./modules/feedback/feedback.routes";
import { fishingRoutes } from "./modules/fishing/fishing.routes";
import { friendsRoutes } from "./modules/friends/friends.routes";
import { inboxRoutes } from "./modules/inbox/inbox.routes";
import { marketRoutes } from "./modules/market/market.routes";
import { mayorRoutes } from "./modules/mayor/mayor.routes";
import { opsRoutes } from "./modules/ops/ops.routes";
import { placesRoutes } from "./modules/places/places.routes";
import { playerRoutes } from "./modules/player/player.routes";
import { questsRoutes } from "./modules/quests/quests.routes";
import { runsRoutes } from "./modules/runs/runs.routes";
import { suggestionsRoutes } from "./modules/suggestions/suggestions.routes";
import { vendorsRoutes } from "./modules/vendors/vendors.routes";
import { wardrobeRoutes } from "./modules/wardrobe/wardrobe.routes";
import type { TravelMemory } from "./modules/world/world.types";
import { worldRoutes } from "./modules/world/world.routes";
import type { Hub } from "./realtime/hub";

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
    /** What each connected player is doing, as their app reports it; friends see it. Cleared when they go. */
    presence: Map<string, { activity: GeoActivity; skill: string | null }>;
    /** Each player's last point and walked distance, for spawns (world/travel.ts). */
    travel: Map<string, TravelMemory>;
    /** Who's connected, and pushes to them (a stand-in until session 5's sockets). */
    hub: Hub;
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

    app.route("/", contentRoutes);
    app.route("/", accountsRoutes);
    app.route("/", playerRoutes);
    app.route("/", wardrobeRoutes);
    app.route("/", worldRoutes);
    app.route("/", placesRoutes);
    app.route("/", runsRoutes);
    app.route("/", fishingRoutes);
    app.route("/", chestsRoutes);
    app.route("/", dungeonsRoutes);
    app.route("/", dungeonRunsRoutes);
    app.route("/", farmingRoutes);
    app.route("/", questsRoutes);
    app.route("/", vendorsRoutes);
    app.route("/", craftingRoutes);
    app.route("/", marketRoutes);
    app.route("/", mayorRoutes);
    app.route("/", friendsRoutes);
    app.route("/", suggestionsRoutes);
    app.route("/", inboxRoutes);
    app.route("/", feedbackRoutes);
    app.route("/", adminRoutes);
    app.route("/", opsRoutes);

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
