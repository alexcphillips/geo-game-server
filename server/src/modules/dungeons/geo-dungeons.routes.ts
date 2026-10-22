import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as dungeonsController from "./geo-dungeons.controller";

/** Dungeon lobbies: list, create, join, leave, and start (everyone goes in). */
export const geoDungeonsRouter: Router = Router();

const paths = GEO_API_PATHS.dungeons;

geoDungeonsRouter.get(paths.root, geoAuth, asyncHandler(dungeonsController.listDungeons));
geoDungeonsRouter.post(paths.lobbies, geoAuth, asyncHandler(dungeonsController.createLobby));
geoDungeonsRouter.post(paths.join, geoAuth, asyncHandler(dungeonsController.joinLobby));
geoDungeonsRouter.post(paths.leave, geoAuth, asyncHandler(dungeonsController.leaveLobby));
geoDungeonsRouter.post(paths.start, geoAuth, asyncHandler(dungeonsController.startLobby));
