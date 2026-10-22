import type { Request, Response } from "express";
import type { GeoInboxReadRequest } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { requirePlayerId } from "../../middleware/geo-auth";
import * as inboxRepository from "./geo-inbox.repository";

export async function getInbox(req: Request, res: Response) {
    res.status(200).json(await inboxRepository.findInbox(requirePlayerId(req)));
}

/** Marks read what the player saw: everything up to the inbox's `asOf`, never later than now. */
export async function markRead(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const { asOf } = (req.body ?? {}) as Partial<GeoInboxReadRequest>;
    const when = typeof asOf === "string" ? new Date(asOf) : null;
    if (!when || Number.isNaN(when.getTime())) throw AppError.badRequest("asOf must be a time");
    await inboxRepository.markRead(playerId, new Date(Math.min(when.getTime(), Date.now())));
    res.status(204).end();
}
