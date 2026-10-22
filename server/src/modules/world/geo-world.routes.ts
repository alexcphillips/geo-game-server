import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as worldController from "./geo-world.controller";

/** What's around the player: enemy spawns, later place info. */
export const geoWorldRouter: Router = Router();

geoWorldRouter.get(GEO_API_PATHS.world, geoAuth, asyncHandler(worldController.getWorld));
geoWorldRouter.post(GEO_API_PATHS.dev.spawn, geoAuth, asyncHandler(worldController.devSpawn));
