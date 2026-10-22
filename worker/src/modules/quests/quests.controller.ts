import type { Context } from "hono";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import * as questsRepository from "./quests.repository";

type Ctx = Context<AppEnv>;

/** Runs `work` (if any) and replies with the quest log, all in one transaction. */
function withLog(c: Ctx, work?: (playerId: string) => void) {
    const playerId = requirePlayerId(c);
    const { db } = c.var.world;
    const body = db.transaction(() => {
        work?.(playerId);
        return questsRepository.listQuests(db, playerId);
    });
    return c.json(body, 200);
}

/** `GET /geo/quests`: hands out any quests now due, then lists them with the player's enemy tier. */
export const listQuests = (c: Ctx) => withLog(c);

/** `PUT /geo/quests/:questId/track`. */
export const trackQuest = (c: Ctx) =>
    withLog(c, (playerId) => questsRepository.trackQuest(c.var.world.db, playerId, c.req.param("questId") ?? ""));

/** `POST /geo/quests/:questId/claim`: turns in a ready quest for its reward, from anywhere. */
export const claimQuest = (c: Ctx) =>
    withLog(c, (playerId) => questsRepository.claimQuest(c.var.world.db, playerId, c.req.param("questId") ?? ""));
