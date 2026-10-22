import { Router } from "express";
import { geoAccountsRouter } from "./modules/accounts/geo-accounts.routes";
import { geoAdminRouter } from "./modules/admin/geo-admin.routes";
import { geoChestsRouter } from "./modules/chests/geo-chests.routes";
import { geoContentRouter } from "./modules/content/geo-content.routes";
import { geoCraftingRouter } from "./modules/crafting/geo-crafting.routes";
import { geoDungeonRunsRouter } from "./modules/dungeon-runs/geo-dungeon-runs.routes";
import { geoDungeonsRouter } from "./modules/dungeons/geo-dungeons.routes";
import { geoFarmingRouter } from "./modules/farming/geo-farming.routes";
import { geoFishingRouter } from "./modules/fishing/geo-fishing.routes";
import { geoFeedbackRouter } from "./modules/feedback/geo-feedback.routes";
import { geoFriendsRouter } from "./modules/friends/geo-friends.routes";
import { geoInboxRouter } from "./modules/inbox/geo-inbox.routes";
import { geoMarketRouter } from "./modules/market/geo-market.routes";
import { geoMayorRouter } from "./modules/mayor/geo-mayor.routes";
import { geoPlacesRouter } from "./modules/places/geo-places.routes";
import { geoPlayerRouter } from "./modules/player/geo-player.routes";
import { geoQuestsRouter } from "./modules/quests/geo-quests.routes";
import { geoRunsRouter } from "./modules/runs/geo-runs.routes";
import { geoSuggestionsRouter } from "./modules/suggestions/geo-suggestions.routes";
import { geoVendorsRouter } from "./modules/vendors/geo-vendors.routes";
import { geoWardrobeRouter } from "./modules/wardrobe/geo-wardrobe.routes";
import { geoWorldRouter } from "./modules/world/geo-world.routes";
import { geoDbErrors } from "./middleware/geo-db-errors";

/**
 * geo-game's route manifest: every geo module, mounted once by `app.ts`.
 * Paths all start with `/geo` (`@geo/shared` → GEO_API_PATHS).
 */
export const geoRouter: Router = Router();

geoRouter.use(geoContentRouter);
geoRouter.use(geoAccountsRouter);
geoRouter.use(geoPlayerRouter);
geoRouter.use(geoWardrobeRouter);
geoRouter.use(geoRunsRouter);
geoRouter.use(geoFishingRouter);
geoRouter.use(geoDungeonsRouter);
geoRouter.use(geoDungeonRunsRouter);
geoRouter.use(geoQuestsRouter);
geoRouter.use(geoFarmingRouter);
geoRouter.use(geoChestsRouter);
geoRouter.use(geoWorldRouter);
geoRouter.use(geoPlacesRouter);
geoRouter.use(geoVendorsRouter);
geoRouter.use(geoCraftingRouter);
geoRouter.use(geoMarketRouter);
geoRouter.use(geoMayorRouter);
geoRouter.use(geoFriendsRouter);
geoRouter.use(geoSuggestionsRouter);
geoRouter.use(geoInboxRouter);
geoRouter.use(geoFeedbackRouter);
geoRouter.use(geoAdminRouter);

// Last: errors from every geo route above.
geoRouter.use(geoDbErrors);
