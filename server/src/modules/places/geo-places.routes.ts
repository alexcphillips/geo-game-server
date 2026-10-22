import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAdmin, geoAuth } from "../../middleware/geo-auth";
import * as placesController from "./geo-places.controller";

/**
 * Hand-made places. Players read the active ones near them; game admins make,
 * edit and remove them, every change audited.
 */
export const geoPlacesRouter: Router = Router();

const adminGuard = [geoAuth, geoAdmin];
const paths = GEO_API_PATHS.admin;

geoPlacesRouter.get(GEO_API_PATHS.places, geoAuth, asyncHandler(placesController.listPlacesNear));

geoPlacesRouter.get(paths.places, adminGuard, asyncHandler(placesController.listPlaces));
geoPlacesRouter.post(paths.places, adminGuard, asyncHandler(placesController.createPlace));
geoPlacesRouter.patch(paths.place, adminGuard, asyncHandler(placesController.updatePlace));
geoPlacesRouter.delete(paths.place, adminGuard, asyncHandler(placesController.deletePlace));
