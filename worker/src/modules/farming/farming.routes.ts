import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as farmingController from "./farming.controller";

/** The farm: look at it anywhere, work it at a farming place. */
export const farmingRoutes = new Hono<AppEnv>();

farmingRoutes.get(GEO_API_PATHS.farm.root, auth, farmingController.getFarm);
farmingRoutes.post(GEO_API_PATHS.farm.actions, auth, farmingController.act);
farmingRoutes.post(GEO_API_PATHS.farm.lab, auth, farmingController.research);
