import type { Context } from "hono";
import { distanceMetres, GEO_PLACE_REACH_METRES, isValidPoint, type GeoCreateDungeonLobbyRequest, type GeoDungeonEntrance } from "@geo/shared";
import { AppError } from "../../../../server/src/http/AppError";
import { isUuid } from "../../../../server/src/lib/validate";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as dungeonsRepository from "./dungeons.repository";

/** Dungeon lobbies, from server/src/modules/dungeons/geo-dungeons.controller.ts. Each request is one transaction. */

type Ctx = Context<AppEnv>;

function lobbyId(c: Ctx): string {
    const id = c.req.param("lobbyId") ?? "";
    if (!isUuid(id)) throw AppError.badRequest("Bad lobby id");
    return id;
}

/**
 * Creating or joining a lobby needs the player at a POI. Both points are the
 * phone's word, like a spawn fight's (see the backend TODO on location
 * spoofing), and tile POIs aren't known to the server, so this only checks
 * the two are within reach. Game admins skip it, as the free camera does.
 */
function assertAtEntrance(c: Ctx, body: Partial<GeoDungeonEntrance>) {
    if (c.var.role === "admin") return;
    if (!isValidPoint(body.position) || !isValidPoint(body.place)) throw AppError.badRequest("position and place are required");
    if (distanceMetres(body.position, body.place) > GEO_PLACE_REACH_METRES) throw AppError.badRequest("Go to a POI to join a lobby");
}

/** The dungeon menu: dungeons, open lobbies, and the player's own. Viewable from anywhere. */
export function listDungeons(c: Ctx) {
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => dungeonsRepository.listDungeons(world, playerId)), 200);
}

export async function createLobby(c: Ctx) {
    const body = (await jsonBody(c)) as Partial<GeoCreateDungeonLobbyRequest>;
    assertAtEntrance(c, body);
    const { dungeonId, requiredLevel } = body;
    if (typeof dungeonId !== "string") throw AppError.badRequest("dungeonId is required");
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => dungeonsRepository.createLobby(world, playerId, dungeonId, requiredLevel)), 201);
}

export async function joinLobby(c: Ctx) {
    assertAtEntrance(c, (await jsonBody(c)) as Partial<GeoDungeonEntrance>);
    const playerId = requirePlayerId(c);
    const id = lobbyId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => dungeonsRepository.joinLobby(world, playerId, id)), 200);
}

export function leaveLobby(c: Ctx) {
    const playerId = requirePlayerId(c);
    const id = lobbyId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => dungeonsRepository.leaveLobby(world, playerId, id)), 200);
}

/** Host only: takes everyone in at once. Replies with the host's Run or the party's map. */
export function startLobby(c: Ctx) {
    const playerId = requirePlayerId(c);
    const id = lobbyId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => dungeonsRepository.startLobby(world, playerId, id)), 200);
}
