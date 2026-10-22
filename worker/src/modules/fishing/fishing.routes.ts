import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as fishingController from "./fishing.controller";

/** Fishing Runs: open one at a spot, cast and fight, leave. */
export const fishingRoutes = new Hono<AppEnv>();

fishingRoutes.post(GEO_API_PATHS.fishing.start, auth, fishingController.startFishing);
fishingRoutes.post(GEO_API_PATHS.fishing.actions, auth, fishingController.act);
fishingRoutes.post(GEO_API_PATHS.fishing.leave, auth, fishingController.leave);
