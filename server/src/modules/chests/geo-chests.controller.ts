import type { Request, Response } from "express";
import type { GeoOpenChestRequest, GeoOpenChestResponse } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { requirePlayerId } from "../../middleware/geo-auth";
import * as chestsRepository from "./geo-chests.repository";

export async function listChests(req: Request, res: Response) {
    res.status(200).json(await chestsRepository.listChests(requirePlayerId(req)));
}

export async function openChest(req: Request, res: Response) {
    const { index } = (req.body ?? {}) as Partial<GeoOpenChestRequest>;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
        throw AppError.badRequest("index must be a chest number");
    }
    const selection = await chestsRepository.openChest(requirePlayerId(req), String(req.params.selectionId), index);
    const body: GeoOpenChestResponse = { selection };
    res.status(200).json(body);
}
