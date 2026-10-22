import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as farmingController from "./geo-farming.controller";

/** The farm: look at it anywhere, work it at a farming place. */
export const geoFarmingRouter: Router = Router();

geoFarmingRouter.get(GEO_API_PATHS.farm.root, geoAuth, asyncHandler(farmingController.getFarm));
geoFarmingRouter.post(GEO_API_PATHS.farm.actions, geoAuth, asyncHandler(farmingController.act));
geoFarmingRouter.post(GEO_API_PATHS.farm.lab, geoAuth, asyncHandler(farmingController.research));
