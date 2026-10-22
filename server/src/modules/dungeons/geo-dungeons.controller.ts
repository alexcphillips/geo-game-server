import type { Request, Response } from "express";
import {
    distanceMetres,
    GEO_PLACE_REACH_METRES,
    isValidPoint,
    type GeoCreateDungeonLobbyRequest,
    type GeoDungeonEntrance,
} from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import { requirePlayerId } from "../../middleware/geo-auth";
import { isUuid } from "../../lib/validate";
import * as dungeonsRepository from "./geo-dungeons.repository";


function lobbyId(req: Request): string {
    const id = String(req.params.lobbyId ?? "");
    if (!isUuid(id)) throw AppError.badRequest("Bad lobby id");
    return id;
}

/**
 * Creating or joining a lobby needs the player at a POI. Both points are the
 * phone's word, like a spawn fight's (see the backend TODO on location
 * spoofing), and tile POIs aren't known to the server, so this only checks
 * the two are within reach. Game admins skip it, as the free camera does.
 */
function assertAtEntrance(req: Request, body: Partial<GeoDungeonEntrance>) {
    if (req.geoRole === "admin") return;
    if (!isValidPoint(body.position) || !isValidPoint(body.place)) {
        throw AppError.badRequest("position and place are required");
    }
    if (distanceMetres(body.position, body.place) > GEO_PLACE_REACH_METRES) {
        throw AppError.badRequest("Go to a POI to join a lobby");
    }
}

/** The dungeon menu: dungeons, open lobbies, and the player's own. Viewable from anywhere. */
export async function listDungeons(req: Request, res: Response) {
    res.status(200).json(await dungeonsRepository.listDungeons(query, requirePlayerId(req)));
}

export async function createLobby(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const body = (req.body ?? {}) as Partial<GeoCreateDungeonLobbyRequest>;
    assertAtEntrance(req, body);
    if (typeof body.dungeonId !== "string") throw AppError.badRequest("dungeonId is required");
    res.status(201).json(await dungeonsRepository.createLobby(playerId, body.dungeonId, body.requiredLevel));
}

export async function joinLobby(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    assertAtEntrance(req, (req.body ?? {}) as Partial<GeoDungeonEntrance>);
    res.status(200).json(await dungeonsRepository.joinLobby(playerId, lobbyId(req)));
}

export async function leaveLobby(req: Request, res: Response) {
    res.status(200).json(await dungeonsRepository.leaveLobby(requirePlayerId(req), lobbyId(req)));
}

/** Host only: takes everyone in at once. Replies with the host's Run. */
export async function startLobby(req: Request, res: Response) {
    res.status(200).json(await dungeonsRepository.startLobby(requirePlayerId(req), lobbyId(req)));
}
