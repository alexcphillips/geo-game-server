import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as runsController from "./geo-runs.controller";

/** Runs: start a fight, play it one card at a time, or flee. */
export const geoRunsRouter: Router = Router();

geoRunsRouter.post(GEO_API_PATHS.runs.start, geoAuth, asyncHandler(runsController.startRun));
geoRunsRouter.get(GEO_API_PATHS.runs.active, geoAuth, asyncHandler(runsController.getActiveRun));
geoRunsRouter.post(GEO_API_PATHS.runs.turns, geoAuth, asyncHandler(runsController.playTurn));
geoRunsRouter.post(GEO_API_PATHS.runs.flee, geoAuth, asyncHandler(runsController.flee));
geoRunsRouter.post(GEO_API_PATHS.dev.kill, geoAuth, asyncHandler(runsController.devKill));
