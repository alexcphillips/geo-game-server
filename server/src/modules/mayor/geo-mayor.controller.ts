import type { Request, Response } from "express";
import type { GeoVoteRequest } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { requirePlayerId } from "../../middleware/geo-auth";
import { isUuid } from "../../lib/validate";
import * as mayorRepository from "./geo-mayor.repository";

export async function getMayor(req: Request, res: Response) {
    res.status(200).json(await mayorRepository.findMayor(requirePlayerId(req)));
}

export async function vote(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const { candidateId } = (req.body ?? {}) as Partial<GeoVoteRequest>;
    if (typeof candidateId !== "string" || !candidateId) throw AppError.badRequest("Missing candidateId");
    const electionId = String(req.params.electionId ?? "");
    if (!isUuid(electionId)) throw AppError.notFound("No such election");

    await mayorRepository.castVote(playerId, electionId, candidateId);
    res.status(201).json(await mayorRepository.findMayor(playerId));
}
