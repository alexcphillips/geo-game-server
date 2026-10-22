import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as mayorController from "./geo-mayor.controller";

/** The mayor in office, and voting in the running election. */
export const geoMayorRouter: Router = Router();

geoMayorRouter.get(GEO_API_PATHS.mayor.root, geoAuth, asyncHandler(mayorController.getMayor));
geoMayorRouter.post(GEO_API_PATHS.mayor.vote, geoAuth, asyncHandler(mayorController.vote));
