import type { Context } from "hono";
import type { GeoDungeonMoveRequest, GeoDungeonPuzzleRequest } from "@geo/shared";
import { AppError } from "../../../../game/src/http/AppError";
import { isUuid } from "../../../../game/src/lib/validate";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as dungeonRunsRepository from "./dungeon-runs.repository";

/** A started dungeon's map. Each request is one transaction. */

type Ctx = Context<AppEnv>;

function dungeonRunId(c: Ctx): string {
    const id = c.req.param("dungeonRunId") ?? "";
    if (!isUuid(id)) throw AppError.badRequest("Bad dungeon run id");
    return id;
}

/** The dungeon run in progress, if any: the map as the player may see it. */
export function getActive(c: Ctx) {
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => dungeonRunsRepository.findActive(world, playerId)), 200);
}

export function getOne(c: Ctx) {
    const playerId = requirePlayerId(c);
    const id = dungeonRunId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => dungeonRunsRepository.findOne(world, playerId, id)), 200);
}

export async function move(c: Ctx) {
    const { roomId } = (await jsonBody(c)) as Partial<GeoDungeonMoveRequest>;
    if (!Number.isInteger(roomId)) throw AppError.badRequest("roomId must be a room number");
    const playerId = requirePlayerId(c);
    const id = dungeonRunId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => dungeonRunsRepository.move(world, playerId, id, roomId!)), 200);
}

export async function answerPuzzle(c: Ctx) {
    const { answer } = (await jsonBody(c)) as Partial<GeoDungeonPuzzleRequest>;
    if (!Number.isInteger(answer)) throw AppError.badRequest("answer must be an option number");
    const playerId = requirePlayerId(c);
    const id = dungeonRunId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => dungeonRunsRepository.answerPuzzle(world, playerId, id, answer!)), 200);
}

export function leave(c: Ctx) {
    const playerId = requirePlayerId(c);
    const id = dungeonRunId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => dungeonRunsRepository.leave(world, playerId, id)), 200);
}
