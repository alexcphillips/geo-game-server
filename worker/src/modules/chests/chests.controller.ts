import type { Context } from "hono";
import type { GeoOpenChestRequest, GeoOpenChestResponse } from "@geo/shared";
import { AppError } from "../../../../game/src/http/AppError";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as chestsRepository from "./chests.repository";

type Ctx = Context<AppEnv>;

export function listChests(c: Ctx) {
    return c.json(chestsRepository.listChests(c.var.world.db, requirePlayerId(c)), 200);
}

export async function openChest(c: Ctx) {
    const { index } = (await jsonBody(c)) as Partial<GeoOpenChestRequest>;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) throw AppError.badRequest("index must be a chest number");
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    const selection = world.db.transaction(() => chestsRepository.openChest(world, playerId, c.req.param("selectionId") ?? "", index));
    const body: GeoOpenChestResponse = { selection };
    return c.json(body, 200);
}
