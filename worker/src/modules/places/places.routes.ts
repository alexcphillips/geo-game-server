import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as placesController from "./places.controller";

/** Hand-made places near the player. Admins' editing routes join in session 4. */
export const placesRoutes = new Hono<AppEnv>();

placesRoutes.get(GEO_API_PATHS.places, auth, placesController.listPlacesNear);
