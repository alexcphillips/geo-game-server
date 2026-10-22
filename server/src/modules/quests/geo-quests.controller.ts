import type { Request, Response } from "express";
import { withTransaction } from "../../db/transaction";
import { requirePlayerId } from "../../middleware/geo-auth";
import * as playerRepository from "../player/geo-player.repository";
import * as questsRepository from "./geo-quests.repository";

/** `GET /geo/quests`: hands out any quests now due, then lists them with the player's enemy tier. */
export async function listQuests(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    res.status(200).json(await withTransaction((tx) => questsRepository.listQuests(tx, playerId)));
}

/** `PUT /geo/quests/:questId/track`. */
export async function trackQuest(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const questId = String(req.params.questId);
    res.status(200).json(
        await withTransaction(async (tx) => {
            await questsRepository.trackQuest(tx, playerId, questId);
            return questsRepository.listQuests(tx, playerId);
        }),
    );
}

/**
 * `POST /geo/quests/:questId/claim`: turns in a ready quest for its reward,
 * from anywhere, and hands out whatever comes after it.
 */
export async function claimQuest(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const questId = String(req.params.questId);
    res.status(200).json(
        await withTransaction(async (tx) => {
            await playerRepository.lockPlayer(tx, playerId);
            await questsRepository.claimQuest(tx, playerId, questId);
            return questsRepository.listQuests(tx, playerId);
        }),
    );
}
