import type { Request, Response } from "express";
import { distanceMetres, isValidPoint, type GeoPlayTurnRequest, type GeoStartRunRequest } from "@geo/shared";
import { IS_PRODUCTION } from "../../config/env";
import { AppError } from "../../http/AppError";
import { query } from "../../db";
import { SPAWN_RULES } from "../../world";
import * as worldRepository from "../world/geo-world.repository";
import { requirePlayerId } from "../../middleware/geo-auth";
import * as runsRepository from "./geo-runs.repository";

/**
 * Starts a fight with a spawn the player is standing near. The position is
 * the phone's word for now (see the backend TODO on location spoofing) and is
 * used for this check only, never stored.
 */
export async function startRun(req: Request, res: Response) {
    const body = (req.body ?? {}) as Partial<GeoStartRunRequest>;
    if (body.kind !== "combat") throw AppError.badRequest("Only combat Runs exist so far");
    const playerId = requirePlayerId(req);

    if (typeof body.spawnId === "string") {
        if (!isValidPoint(body.position)) throw AppError.badRequest("position is required");
        const spawn = await worldRepository.findLiveSpawn(query, playerId, body.spawnId);
        if (!spawn) throw AppError.badRequest("That enemy has moved on");
        if (distanceMetres(body.position, spawn) > SPAWN_RULES.reachMetres) {
            throw AppError.badRequest("Too far away");
        }
        res.status(201).json(
            await runsRepository.startCombatRun(playerId, { enemyId: spawn.enemyId, spawnId: spawn.id }),
        );
        return;
    }

    // Dev servers only: fight any enemy, anywhere, for testing.
    if (typeof body.enemyId === "string" && !IS_PRODUCTION) {
        res.status(201).json(await runsRepository.startCombatRun(playerId, { enemyId: body.enemyId, spawnId: null }));
        return;
    }

    throw AppError.badRequest("Missing spawnId");
}

/** Dev servers only: die on the spot, to test the death screen and coin loss. */
export async function devKill(req: Request, res: Response) {
    if (IS_PRODUCTION) throw AppError.notFound("Not found");
    res.status(200).json(await runsRepository.killPlayer(requirePlayerId(req), "admin-kill"));
}

/** The Run in progress, if any — for picking a fight back up after a restart. */
export async function getActiveRun(req: Request, res: Response) {
    res.status(200).json(await runsRepository.findActiveRun(requirePlayerId(req)));
}

export async function playTurn(req: Request, res: Response) {
    const body = (req.body ?? {}) as Partial<{ inventoryId: unknown; targetId: unknown; lunchboxSlot: unknown }>;
    const playerId = requirePlayerId(req);
    const runId = String(req.params.runId);

    if (body.lunchboxSlot !== undefined) {
        if (!Number.isInteger(body.lunchboxSlot)) throw AppError.badRequest("lunchboxSlot must be a slot number");
        res.status(200).json(await runsRepository.playTurn(playerId, runId, { lunchboxSlot: body.lunchboxSlot as number }));
        return;
    }

    if (typeof body.inventoryId !== "string") throw AppError.badRequest("Missing inventoryId or lunchboxSlot");
    if (body.targetId !== undefined && typeof body.targetId !== "string") {
        throw AppError.badRequest("targetId must be a string");
    }

    const play: GeoPlayTurnRequest = { inventoryId: body.inventoryId, targetId: body.targetId };
    res.status(200).json(await runsRepository.playTurn(playerId, runId, play));
}

export async function flee(req: Request, res: Response) {
    res.status(200).json(await runsRepository.fleeRun(requirePlayerId(req), String(req.params.runId)));
}
