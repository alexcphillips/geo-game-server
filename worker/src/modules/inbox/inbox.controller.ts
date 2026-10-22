import type { Context } from "hono";
import type { GeoInboxReadRequest } from "@geo/shared";
import { AppError } from "../../../../server/src/http/AppError";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as inboxRepository from "./inbox.repository";

type Ctx = Context<AppEnv>;

export function getInbox(c: Ctx) {
    return c.json(inboxRepository.findInbox(c.var.world.db, requirePlayerId(c)), 200);
}

/** Marks read what the player saw: everything up to the inbox's `asOf`, never later than now. */
export async function markRead(c: Ctx) {
    const { asOf } = (await jsonBody(c)) as Partial<GeoInboxReadRequest>;
    const when = typeof asOf === "string" ? Date.parse(asOf) : NaN;
    if (Number.isNaN(when)) throw AppError.badRequest("asOf must be a time");
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    world.db.transaction(() => inboxRepository.markRead(world, playerId, Math.min(when, Date.now())));
    return c.body(null, 204);
}
