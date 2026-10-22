import type { Context } from "hono";
import type { GeoVoteRequest } from "@geo/shared";
import { AppError } from "../../../../game/src/http/AppError";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as mayorRepository from "./mayor.repository";

type Ctx = Context<AppEnv>;

export function getMayor(c: Ctx) {
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => mayorRepository.findMayor(world, playerId)), 200);
}

export async function vote(c: Ctx) {
    const { candidateId } = (await jsonBody(c)) as Partial<GeoVoteRequest>;
    if (typeof candidateId !== "string" || !candidateId) throw AppError.badRequest("Missing candidateId");
    const playerId = requirePlayerId(c);
    const electionId = c.req.param("electionId") ?? "";
    const { world } = c.var;
    const body = world.db.transaction(() => {
        mayorRepository.castVote(world, playerId, electionId, candidateId);
        return mayorRepository.findMayor(world, playerId);
    });
    return c.json(body, 201);
}
