import { CONTENT } from "../../../../server/src/content";
import {
    killTargets,
    openTier,
    progressAfter,
    questsToGive,
    type QuestEvent,
    type QuestProgress,
} from "../../../../server/src/modules/quests/geo-quests.rules";
import type { Db } from "../../db/db";
import { findSkillLevels } from "../player/player.repository";
import { FIND_QUESTS, INSERT_QUEST, SET_PROGRESS } from "./quests.sql.ts";

type QuestRow = { quest_id: string; progress: string; tracked: number; started_at: number; claimed_at: number | null };

const claimedIds = (rows: QuestRow[]) => new Set(rows.filter((row) => row.claimed_at !== null).map((row) => row.quest_id));

/** The highest enemy tier open to the player: combat level and Trials turned in. */
export function findOpenTier(db: Db, playerId: string): number {
    return openTier(findSkillLevels(db, playerId).combat ?? 1, claimedIds(db.all<QuestRow>(FIND_QUESTS, playerId)));
}

/** Enemies the player's quests still need killed, for spawns to pull toward. */
export function findKillTargets(db: Db, playerId: string): string[] {
    const targets = db.all<QuestRow>(FIND_QUESTS, playerId).flatMap((row) => {
        const quest = CONTENT.quests[row.quest_id];
        return row.claimed_at === null && quest ? killTargets(quest, JSON.parse(row.progress) as QuestProgress) : [];
    });
    return [...new Set(targets)];
}

/**
 * Gives the player every quest now due (see questsToGive). The first given
 * is tracked when nothing else is, so a new player's tracker shows it.
 * Returns the rows as they stand after.
 */
function giveQuests(db: Db, playerId: string): QuestRow[] {
    const rows = db.all<QuestRow>(FIND_QUESTS, playerId);
    const claimed = claimedIds(rows);
    const due = questsToGive(new Set(rows.map((row) => row.quest_id)), claimed, openTier(findSkillLevels(db, playerId).combat ?? 1, claimed));
    if (due.length === 0) return rows;
    let tracking = !rows.some((row) => row.claimed_at === null && row.tracked);
    const now = Date.now();
    for (const quest of due) {
        db.run(INSERT_QUEST, playerId, quest.id, tracking ? 1 : 0, now);
        tracking = false;
    }
    return db.all<QuestRow>(FIND_QUESTS, playerId);
}

/**
 * Counts `events` toward every quest the player holds, in the caller's
 * transaction: a won fight's kills, a dungeon cleared. Quests due are given
 * first, so a new player's first kill counts. Writes only quests that moved.
 */
export function recordQuestEvents(db: Db, playerId: string, events: QuestEvent[]) {
    if (events.length === 0) return;
    for (const row of giveQuests(db, playerId)) {
        const quest = CONTENT.quests[row.quest_id];
        if (row.claimed_at !== null || !quest) continue;
        const next = progressAfter(quest, JSON.parse(row.progress) as QuestProgress, events);
        if (next) db.run(SET_PROGRESS, JSON.stringify(next), playerId, row.quest_id);
    }
}
