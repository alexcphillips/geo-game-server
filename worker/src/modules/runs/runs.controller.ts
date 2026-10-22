import type { Context } from "hono";
import { distanceMetres, isValidPoint, type GeoStartRunRequest } from "@geo/shared";
import { AppError } from "../../../../game/src/http/AppError";
import { SPAWN_RULES } from "../../../../game/src/world/spawns";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import { devTools } from "../../http/dev";
import * as worldRepository from "../world/world.repository";
import * as runsRepository from "./runs.repository";
import type { TurnPlay } from "./runs.repository";

/** Fights. Each request is one transaction. */

type Ctx = Context<AppEnv>;

/**
 * Starts a fight with a spawn the player is standing near. The position is
 * the phone's word for now (see the backend TODO on location spoofing) and is
 * used for this check only, never stored. With dev tools on, `enemyId`
 * fights any enemy, anywhere.
 */
export async function startRun(c: Ctx) {
    const body = (await jsonBody(c)) as Partial<GeoStartRunRequest>;
    if (body.kind !== "combat") throw AppError.badRequest("Only combat Runs exist so far");
    const playerId = requirePlayerId(c);
    const { world } = c.var;

    if (typeof body.spawnId === "string") {
        const spawnId = body.spawnId;
        if (!isValidPoint(body.position)) throw AppError.badRequest("position is required");
        const position = body.position;
        return c.json(
            world.db.transaction(() => {
                const spawn = worldRepository.findLiveSpawn(world, playerId, spawnId, Date.now());
                if (!spawn) throw AppError.badRequest("That enemy has moved on");
                if (distanceMetres(position, spawn) > SPAWN_RULES.reachMetres) throw AppError.badRequest("Too far away");
                return runsRepository.startCombatRun(world, playerId, { enemyId: spawn.enemyId, spawnId: spawn.id });
            }),
            201,
        );
    }

    if (typeof body.enemyId === "string" && devTools(c)) {
        const enemyId = body.enemyId;
        return c.json(world.db.transaction(() => runsRepository.startCombatRun(world, playerId, { enemyId, spawnId: null })), 201);
    }

    throw AppError.badRequest("Missing spawnId");
}

/** Dev tools only: die on the spot, to test the death screen and coin loss. */
export function devKill(c: Ctx) {
    if (!devTools(c)) throw AppError.notFound("Not found");
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => runsRepository.killPlayer(world, playerId, "admin-kill")), 200);
}

/** The Run in progress, if any — for picking a fight back up after a restart. */
export function getActiveRun(c: Ctx) {
    const playerId = requirePlayerId(c);
    const { db } = c.var.world;
    return c.json(db.transaction(() => runsRepository.findActiveRun(db, playerId)), 200);
}

export async function playTurn(c: Ctx) {
    const body = await jsonBody(c);
    let play: TurnPlay;
    if (body.lunchboxSlot !== undefined) {
        if (!Number.isInteger(body.lunchboxSlot)) throw AppError.badRequest("lunchboxSlot must be a slot number");
        play = { lunchboxSlot: body.lunchboxSlot as number };
    } else {
        if (typeof body.inventoryId !== "string") throw AppError.badRequest("Missing inventoryId or lunchboxSlot");
        if (body.targetId !== undefined && typeof body.targetId !== "string") throw AppError.badRequest("targetId must be a string");
        play = { inventoryId: body.inventoryId, targetId: body.targetId };
    }
    const playerId = requirePlayerId(c);
    const runId = c.req.param("runId") ?? "";
    const { world } = c.var;
    return c.json(world.db.transaction(() => runsRepository.playTurn(world, playerId, runId, play)), 200);
}

export function flee(c: Ctx) {
    const playerId = requirePlayerId(c);
    const runId = c.req.param("runId") ?? "";
    const { world } = c.var;
    return c.json(world.db.transaction(() => runsRepository.fleeRun(world, playerId, runId)), 200);
}
