import type { Request, Response } from "express";
import { GEO_FARM_ACTION_TYPES, type GeoFarmAction } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { requirePlayerId } from "../../middleware/geo-auth";
import * as farmingRepository from "./geo-farming.repository";

export async function getFarm(req: Request, res: Response) {
    res.status(200).json(await farmingRepository.findFarm(requirePlayerId(req)));
}

/** Turn a mutation in at the Research Lab. */
export async function research(req: Request, res: Response) {
    const mutationId = (req.body as Record<string, unknown> | undefined)?.mutationId;
    if (typeof mutationId !== "string") throw AppError.badRequest("Missing mutationId");
    res.status(200).json(await farmingRepository.research(requirePlayerId(req), { mutationId }));
}

const isInt = (value: unknown): value is number => Number.isInteger(value);

/**
 * One farm action. PLACEHOLDER: the server can't yet tell the player is at
 * a farming place (same as fishing's water tier, see the backend TODO on
 * location spoofing), so the app only offers work at one.
 */
export async function act(req: Request, res: Response) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = body.type;
    if (!(GEO_FARM_ACTION_TYPES as readonly unknown[]).includes(type)) throw AppError.badRequest("type must be a farm action");

    let action: GeoFarmAction;
    if (type === "harvest-all") {
        action = { type };
    } else if (type === "plant-all") {
        if (body.itemId !== null && typeof body.itemId !== "string") throw AppError.badRequest("itemId must be seeds or null");
        action = { type, itemId: body.itemId };
    } else if (type === "buy" || type === "pesthunter-buy") {
        if (!isInt(body.offer)) throw AppError.badRequest("Missing offer");
        action = { type, offer: body.offer };
    } else if (type === "accept-order" || type === "deliver-order") {
        if (typeof body.orderId !== "string") throw AppError.badRequest("Missing orderId");
        action = { type, orderId: body.orderId };
    } else if (type === "offer") {
        if (!isInt(body.tile) || typeof body.itemId !== "string" || !isInt(body.quantity)) throw AppError.badRequest("Missing tile, itemId or quantity");
        action = { type, tile: body.tile, itemId: body.itemId, quantity: body.quantity };
    } else {
        if (!isInt(body.tile)) throw AppError.badRequest("Missing tile");
        const tile = body.tile;
        if (type === "plant") {
            if (typeof body.itemId !== "string") throw AppError.badRequest("Missing itemId");
            action = { type, tile, itemId: body.itemId };
        } else if (type === "play") {
            if (typeof body.inventoryId !== "string") throw AppError.badRequest("Missing inventoryId");
            action = { type, tile, inventoryId: body.inventoryId };
        } else if (type === "place") {
            if (typeof body.structureId !== "string") throw AppError.badRequest("Missing structureId");
            action = { type, tile, structureId: body.structureId };
        } else if (type === "tune") {
            if (body.pestId !== null && typeof body.pestId !== "string") throw AppError.badRequest("pestId must be a pest or null");
            action = { type, tile, pestId: body.pestId };
        } else if (type === "blueprint") {
            if (body.cropId !== null && typeof body.cropId !== "string") throw AppError.badRequest("cropId must be a crop or null");
            action = { type, tile, cropId: body.cropId };
        } else {
            action = { type: type as "harvest" | "clear" | "demolish" | "cage" | "release" | "turn-in" | "unlock", tile };
        }
    }
    res.status(200).json(await farmingRepository.actFarm(requirePlayerId(req), action));
}
