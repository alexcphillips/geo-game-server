import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as chestsController from "./chests.controller";

/** Chests: pending selections and history, and opening one chest of a selection. */
export const chestsRoutes = new Hono<AppEnv>();

chestsRoutes.get(GEO_API_PATHS.chests.root, auth, chestsController.listChests);
chestsRoutes.post(GEO_API_PATHS.chests.open, auth, chestsController.openChest);
