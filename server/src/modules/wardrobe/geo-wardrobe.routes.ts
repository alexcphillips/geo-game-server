import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as wardrobeController from "./geo-wardrobe.controller";

/** The wardrobe: saved loadouts, switching between them, and its upgrades. */
export const geoWardrobeRouter: Router = Router();

// The purchase first, so "buy-slot" is never read as a slot number.
geoWardrobeRouter.post(GEO_API_PATHS.me.buyLoadoutSlot, geoAuth, asyncHandler(wardrobeController.buyLoadoutSlot));
geoWardrobeRouter.put(GEO_API_PATHS.me.loadout, geoAuth, asyncHandler(wardrobeController.saveLoadout));
geoWardrobeRouter.delete(GEO_API_PATHS.me.loadout, geoAuth, asyncHandler(wardrobeController.deleteLoadout));
geoWardrobeRouter.post(GEO_API_PATHS.me.wearLoadout, geoAuth, asyncHandler(wardrobeController.wearLoadout));
geoWardrobeRouter.put(GEO_API_PATHS.me.loadoutAuto, geoAuth, asyncHandler(wardrobeController.setLoadoutAuto));
