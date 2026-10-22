import type { Context } from "hono";
import { GEO_FISHING_ACTION_TYPES, GEO_FISHING_TIERS, type GeoFishingAction, type GeoFishingTier } from "@geo/shared";
import { AppError } from "../../../../game/src/http/AppError";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as fishingRepository from "./fishing.repository";

type Ctx = Context<AppEnv>;

/**
 * Opens a fishing Run at water of the given tier. The tier is the app's word
 * for now: fishing water comes from the map tiles, which the server doesn't
 * have (see the backend TODO on location spoofing).
 */
export async function startFishing(c: Ctx) {
    const { tier } = await jsonBody(c);
    if (!GEO_FISHING_TIERS.includes(tier as GeoFishingTier)) throw AppError.badRequest("tier must be a fishing tier");
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => fishingRepository.startFishing(world, playerId, tier as GeoFishingTier)), 201);
}

export async function act(c: Ctx) {
    const body = await jsonBody(c);
    if (!(GEO_FISHING_ACTION_TYPES as readonly unknown[]).includes(body.type)) throw AppError.badRequest("type must be a fishing action");
    let action: GeoFishingAction;
    if (body.type === "play") {
        if (typeof body.inventoryId !== "string") throw AppError.badRequest("Missing inventoryId");
        action = { type: "play", inventoryId: body.inventoryId };
    } else {
        action = { type: body.type as Exclude<GeoFishingAction["type"], "play"> };
    }
    const playerId = requirePlayerId(c);
    const runId = c.req.param("runId") ?? "";
    const { world } = c.var;
    return c.json(world.db.transaction(() => fishingRepository.actFishing(world, playerId, runId, action)), 200);
}

export function leave(c: Ctx) {
    const playerId = requirePlayerId(c);
    const runId = c.req.param("runId") ?? "";
    const { world } = c.var;
    world.db.transaction(() => fishingRepository.leaveFishing(world, playerId, runId));
    return c.body(null, 204);
}
