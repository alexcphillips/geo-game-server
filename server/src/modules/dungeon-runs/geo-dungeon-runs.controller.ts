import type { Request, Response } from "express";
import type { GeoDungeonMoveRequest, GeoDungeonPuzzleRequest } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { requirePlayerId } from "../../middleware/geo-auth";
import { isUuid } from "../../lib/validate";
import * as dungeonRunsRepository from "./geo-dungeon-runs.repository";


function dungeonRunId(req: Request): string {
    const id = String(req.params.dungeonRunId ?? "");
    if (!isUuid(id)) throw AppError.badRequest("Bad dungeon run id");
    return id;
}

/** The dungeon run in progress, if any: the map as the player may see it. */
export async function getActive(req: Request, res: Response) {
    res.status(200).json(await dungeonRunsRepository.findActive(requirePlayerId(req)));
}

export async function getOne(req: Request, res: Response) {
    res.status(200).json(await dungeonRunsRepository.findOne(requirePlayerId(req), dungeonRunId(req)));
}

export async function move(req: Request, res: Response) {
    const { roomId } = (req.body ?? {}) as Partial<GeoDungeonMoveRequest>;
    if (!Number.isInteger(roomId)) throw AppError.badRequest("roomId must be a room number");
    res.status(200).json(await dungeonRunsRepository.move(requirePlayerId(req), dungeonRunId(req), roomId as number));
}

export async function answerPuzzle(req: Request, res: Response) {
    const { answer } = (req.body ?? {}) as Partial<GeoDungeonPuzzleRequest>;
    if (!Number.isInteger(answer)) throw AppError.badRequest("answer must be an option number");
    res.status(200).json(await dungeonRunsRepository.answerPuzzle(requirePlayerId(req), dungeonRunId(req), answer as number));
}

export async function leave(req: Request, res: Response) {
    res.status(200).json(await dungeonRunsRepository.leave(requirePlayerId(req), dungeonRunId(req)));
}
