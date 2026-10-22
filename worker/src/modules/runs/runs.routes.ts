import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as runsController from "./runs.controller";

/** Runs: start a fight, play it one card at a time, or flee. */
export const runsRoutes = new Hono<AppEnv>();

runsRoutes.post(GEO_API_PATHS.runs.start, auth, runsController.startRun);
runsRoutes.get(GEO_API_PATHS.runs.active, auth, runsController.getActiveRun);
runsRoutes.post(GEO_API_PATHS.runs.turns, auth, runsController.playTurn);
runsRoutes.post(GEO_API_PATHS.runs.flee, auth, runsController.flee);
runsRoutes.post(GEO_API_PATHS.dev.kill, auth, runsController.devKill);
