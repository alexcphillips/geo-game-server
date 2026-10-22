import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as mayorController from "./mayor.controller";

/** The mayor in office, and voting in the running election. */
export const mayorRoutes = new Hono<AppEnv>();

mayorRoutes.get(GEO_API_PATHS.mayor.root, auth, mayorController.getMayor);
mayorRoutes.post(GEO_API_PATHS.mayor.vote, auth, mayorController.vote);
