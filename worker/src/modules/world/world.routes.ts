import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as worldController from "./world.controller";

/** What's around the player: enemy spawns. */
export const worldRoutes = new Hono<AppEnv>();

worldRoutes.get(GEO_API_PATHS.world, auth, worldController.getWorld);
worldRoutes.post(GEO_API_PATHS.dev.spawn, auth, worldController.devSpawn);
