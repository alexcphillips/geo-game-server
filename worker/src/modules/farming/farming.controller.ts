import type { Context } from "hono";
import { GEO_FARM_ACTION_TYPES, type GeoFarmAction } from "@geo/shared";
import { AppError } from "../../../../server/src/http/AppError";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as farmingRepository from "./farming.repository";

/** The farm, from server/src/modules/farming/geo-farming.controller.ts. Each request is one transaction. */

type Ctx = Context<AppEnv>;

export function getFarm(c: Ctx) {
    const playerId = requirePlayerId(c);
    const { db } = c.var.world;
    return c.json(db.transaction(() => farmingRepository.findFarm(db, playerId)), 200);
}

/** Turn a mutation in at the Research Lab. */
export async function research(c: Ctx) {
    const { mutationId } = await jsonBody(c);
    if (typeof mutationId !== "string") throw AppError.badRequest("Missing mutationId");
    const playerId = requirePlayerId(c);
    const { db } = c.var.world;
    return c.json(db.transaction(() => farmingRepository.research(db, playerId, { mutationId })), 200);
}

const isInt = (value: unknown): value is number => Number.isInteger(value);

/** The body as a farm action, or a 400. */
function parseAction(body: Record<string, unknown>): GeoFarmAction {
    const type = body.type;
    if (!(GEO_FARM_ACTION_TYPES as readonly unknown[]).includes(type)) throw AppError.badRequest("type must be a farm action");
    if (type === "harvest-all") return { type };
    if (type === "plant-all") {
        if (body.itemId !== null && typeof body.itemId !== "string") throw AppError.badRequest("itemId must be seeds or null");
        return { type, itemId: body.itemId };
    }
    if (type === "buy" || type === "pesthunter-buy") {
        if (!isInt(body.offer)) throw AppError.badRequest("Missing offer");
        return { type, offer: body.offer };
    }
    if (type === "accept-order" || type === "deliver-order") {
        if (typeof body.orderId !== "string") throw AppError.badRequest("Missing orderId");
        return { type, orderId: body.orderId };
    }
    if (type === "offer") {
        if (!isInt(body.tile) || typeof body.itemId !== "string" || !isInt(body.quantity)) throw AppError.badRequest("Missing tile, itemId or quantity");
        return { type, tile: body.tile, itemId: body.itemId, quantity: body.quantity };
    }
    if (!isInt(body.tile)) throw AppError.badRequest("Missing tile");
    const tile = body.tile;
    if (type === "plant") {
        if (typeof body.itemId !== "string") throw AppError.badRequest("Missing itemId");
        return { type, tile, itemId: body.itemId };
    }
    if (type === "play") {
        if (typeof body.inventoryId !== "string") throw AppError.badRequest("Missing inventoryId");
        return { type, tile, inventoryId: body.inventoryId };
    }
    if (type === "place") {
        if (typeof body.structureId !== "string") throw AppError.badRequest("Missing structureId");
        return { type, tile, structureId: body.structureId };
    }
    if (type === "tune") {
        if (body.pestId !== null && typeof body.pestId !== "string") throw AppError.badRequest("pestId must be a pest or null");
        return { type, tile, pestId: body.pestId };
    }
    if (type === "blueprint") {
        if (body.cropId !== null && typeof body.cropId !== "string") throw AppError.badRequest("cropId must be a crop or null");
        return { type, tile, cropId: body.cropId };
    }
    return { type: type as "harvest" | "clear" | "demolish" | "cage" | "release" | "turn-in" | "unlock", tile };
}

/**
 * One farm action. PLACEHOLDER: the server can't yet tell the player is at
 * a farming place (same as fishing's water tier, see the backend TODO on
 * location spoofing), so the app only offers work at one.
 */
export async function act(c: Ctx) {
    const action = parseAction(await jsonBody(c));
    const playerId = requirePlayerId(c);
    const { db } = c.var.world;
    return c.json(db.transaction(() => farmingRepository.actFarm(db, playerId, action)), 200);
}
