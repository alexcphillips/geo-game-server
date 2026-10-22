import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as craftingController from "./geo-crafting.controller";

/** Crafting: recipes come with the content; this makes them. */
export const geoCraftingRouter: Router = Router();

geoCraftingRouter.post(GEO_API_PATHS.crafting.craft, geoAuth, asyncHandler(craftingController.craft));
