import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import * as contentController from "./content.controller";

/** Public: nothing here is per-player. */
export const contentRoutes = new Hono<AppEnv>();

contentRoutes.get(GEO_API_PATHS.health, contentController.getHealth);
contentRoutes.get(GEO_API_PATHS.content, contentController.getContent);
