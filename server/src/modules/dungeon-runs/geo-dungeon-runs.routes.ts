import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as dungeonRunsController from "./geo-dungeon-runs.controller";

/** Dungeon runs: the map of a started dungeon, walked room by room. Room fights use the Run routes. */
export const geoDungeonRunsRouter: Router = Router();

const paths = GEO_API_PATHS.dungeonRuns;

// Before `one`: "active" isn't an id.
geoDungeonRunsRouter.get(paths.active, geoAuth, asyncHandler(dungeonRunsController.getActive));
geoDungeonRunsRouter.get(paths.one, geoAuth, asyncHandler(dungeonRunsController.getOne));
geoDungeonRunsRouter.post(paths.move, geoAuth, asyncHandler(dungeonRunsController.move));
geoDungeonRunsRouter.post(paths.puzzle, geoAuth, asyncHandler(dungeonRunsController.answerPuzzle));
geoDungeonRunsRouter.post(paths.leave, geoAuth, asyncHandler(dungeonRunsController.leave));
