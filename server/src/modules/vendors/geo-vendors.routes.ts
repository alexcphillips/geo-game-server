import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as vendorsController from "./geo-vendors.controller";

/** NPC vendors: what they sell and buy, and trading with them. */
export const geoVendorsRouter: Router = Router();

geoVendorsRouter.get(GEO_API_PATHS.vendors.list, geoAuth, asyncHandler(vendorsController.listVendors));
geoVendorsRouter.post(GEO_API_PATHS.vendors.buy, geoAuth, asyncHandler(vendorsController.buy));
geoVendorsRouter.post(GEO_API_PATHS.vendors.sell, geoAuth, asyncHandler(vendorsController.sell));
geoVendorsRouter.post(GEO_API_PATHS.vendors.reforge, geoAuth, asyncHandler(vendorsController.reforge));
geoVendorsRouter.post(GEO_API_PATHS.vendors.petUpgrade, geoAuth, asyncHandler(vendorsController.upgradePet));
geoVendorsRouter.post(GEO_API_PATHS.vendors.collectPetUpgrade, geoAuth, asyncHandler(vendorsController.collectPetUpgrade));
