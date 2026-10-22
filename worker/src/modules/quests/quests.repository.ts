import { CONTENT } from "../../../../server/src/content";
import { killTargets, openTier, type QuestProgress } from "../../../../server/src/modules/quests/geo-quests.rules";
import type { Db } from "../../db/db";
import { findSkillLevels } from "../player/player.repository";
import { FIND_QUESTS } from "./quests.sql.ts";

type QuestRow = { quest_id: string; progress: string; tracked: number; started_at: number; claimed_at: number | null };

/** The highest enemy tier open to the player: combat level and Trials turned in. */
export function findOpenTier(db: Db, playerId: string): number {
    const claimed = new Set(
        db.all<QuestRow>(FIND_QUESTS, playerId).filter((row) => row.claimed_at !== null).map((row) => row.quest_id),
    );
    return openTier(findSkillLevels(db, playerId).combat ?? 1, claimed);
}

/** Enemies the player's quests still need killed, for spawns to pull toward. */
export function findKillTargets(db: Db, playerId: string): string[] {
    const targets = db.all<QuestRow>(FIND_QUESTS, playerId).flatMap((row) => {
        const quest = CONTENT.quests[row.quest_id];
        return row.claimed_at === null && quest ? killTargets(quest, JSON.parse(row.progress) as QuestProgress) : [];
    });
    return [...new Set(targets)];
}
