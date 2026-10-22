import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as fishingController from "./geo-fishing.controller";

/** Fishing Runs: open one at a spot, cast and fight, leave. */
export const geoFishingRouter: Router = Router();

geoFishingRouter.post(GEO_API_PATHS.fishing.start, geoAuth, asyncHandler(fishingController.startFishing));
geoFishingRouter.post(GEO_API_PATHS.fishing.actions, geoAuth, asyncHandler(fishingController.act));
geoFishingRouter.post(GEO_API_PATHS.fishing.leave, geoAuth, asyncHandler(fishingController.leave));
