import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as chestsController from "./geo-chests.controller";

/** Chests: pending selections and history, and opening one chest of a selection. */
export const geoChestsRouter: Router = Router();

geoChestsRouter.get(GEO_API_PATHS.chests.root, geoAuth, asyncHandler(chestsController.listChests));
geoChestsRouter.post(GEO_API_PATHS.chests.open, geoAuth, asyncHandler(chestsController.openChest));
