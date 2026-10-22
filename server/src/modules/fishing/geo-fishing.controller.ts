import type { Request, Response } from "express";
import { GEO_FISHING_ACTION_TYPES, GEO_FISHING_TIERS, type GeoFishingAction, type GeoFishingTier } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { requirePlayerId } from "../../middleware/geo-auth";
import * as fishingRepository from "./geo-fishing.repository";

/**
 * Opens a fishing Run at water of the given tier. The tier is the app's word
 * for now: fishing water comes from the map tiles, which the server doesn't
 * have (see the backend TODO on location spoofing).
 */
export async function startFishing(req: Request, res: Response) {
    const { tier } = (req.body ?? {}) as { tier?: unknown };
    if (!GEO_FISHING_TIERS.includes(tier as GeoFishingTier)) throw AppError.badRequest("tier must be a fishing tier");
    res.status(201).json(await fishingRepository.startFishing(requirePlayerId(req), tier as GeoFishingTier));
}

export async function act(req: Request, res: Response) {
    const body = (req.body ?? {}) as { type?: unknown; inventoryId?: unknown };
    if (!(GEO_FISHING_ACTION_TYPES as readonly unknown[]).includes(body.type)) {
        throw AppError.badRequest("type must be a fishing action");
    }
    let action: GeoFishingAction;
    if (body.type === "play") {
        if (typeof body.inventoryId !== "string") throw AppError.badRequest("Missing inventoryId");
        action = { type: "play", inventoryId: body.inventoryId };
    } else {
        action = { type: body.type as Exclude<GeoFishingAction["type"], "play"> };
    }
    res.status(200).json(await fishingRepository.actFishing(requirePlayerId(req), String(req.params.runId), action));
}

export async function leave(req: Request, res: Response) {
    await fishingRepository.leaveFishing(requirePlayerId(req), String(req.params.runId));
    res.status(204).end();
}
