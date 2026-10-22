import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as dungeonsController from "./dungeons.controller";

/** Dungeon lobbies: list, create, join, leave, and start (everyone goes in). */
export const dungeonsRoutes = new Hono<AppEnv>();

const paths = GEO_API_PATHS.dungeons;

dungeonsRoutes.get(paths.root, auth, dungeonsController.listDungeons);
dungeonsRoutes.post(paths.lobbies, auth, dungeonsController.createLobby);
dungeonsRoutes.post(paths.join, auth, dungeonsController.joinLobby);
dungeonsRoutes.post(paths.leave, auth, dungeonsController.leaveLobby);
dungeonsRoutes.post(paths.start, auth, dungeonsController.startLobby);
