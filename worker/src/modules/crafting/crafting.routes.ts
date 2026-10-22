import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as craftingController from "./crafting.controller";

/** Crafting: every recipe is visible to everyone (GET /geo/content); this makes one. */
export const craftingRoutes = new Hono<AppEnv>();

craftingRoutes.post(GEO_API_PATHS.crafting.craft, auth, craftingController.craft);
