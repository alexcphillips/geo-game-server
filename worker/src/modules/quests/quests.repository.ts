import type { GeoQuestsResponse, GeoQuestView } from "@geo/shared";
import { CONTENT, type QuestDef } from "../../../../server/src/content";
import { AppError } from "../../../../server/src/http/AppError";
import {
    combatTierView,
    isComplete,
    killTargets,
    needsHistory,
    objectiveViews,
    openTier,
    progressAfter,
    questsToGive,
    withHistory,
    type QuestEvent,
    type QuestHistory,
    type QuestProgress,
} from "../../../../server/src/modules/quests/geo-quests.rules";
import type { Db } from "../../db/db";
import { addCoins, findSkillLevels, grantItems } from "../player/player.repository";
import { CLAIM_QUEST, FIND_QUEST_HISTORY, FIND_QUESTS, INSERT_QUEST, SET_PROGRESS, SET_TRACKED } from "./quests.sql.ts";

/** The quest log, from server/src/modules/quests/geo-quests.repository.ts. */

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

/**
 * A held quest's progress, with camp and deposit objectives counted from
 * what the player has done (QuestHistory), so doing them before the quest
 * was given counts. The history is read at most once, and only if a quest needs it.
 */
function progressReader(db: Db, playerId: string) {
    let history: QuestHistory | undefined;
    return (quest: QuestDef, row: QuestRow): QuestProgress => {
        const progress = JSON.parse(row.progress) as QuestProgress;
        if (!needsHistory(quest)) return progress;
        if (!history) {
            const found = db.one<{ camp_placed: number; deposited: number }>(FIND_QUEST_HISTORY, playerId);
            history = { campPlaced: found?.camp_placed === 1, deposited: found?.deposited ?? 0 };
        }
        return withHistory(quest, progress, history);
    };
}

function toQuestView(quest: QuestDef, row: QuestRow, progress: QuestProgress): GeoQuestView {
    return {
        id: quest.id,
        title: quest.title,
        giver: quest.giver,
        status: isComplete(quest, progress) ? "ready" : "active",
        objectives: objectiveViews(quest, progress),
        tracked: row.tracked === 1,
        startedAt: new Date(row.started_at).toISOString(),
        unlocksTier: quest.unlocksTier,
        rewards: quest.rewards,
    };
}

/** Gives any quests due, then lists those held (quests gone from the content are left out). In a transaction. */
export function listQuests(db: Db, playerId: string): GeoQuestsResponse {
    const rows = giveQuests(db, playerId);
    const progressOf = progressReader(db, playerId);
    const quests = rows.flatMap((row) => {
        const quest = CONTENT.quests[row.quest_id];
        return row.claimed_at === null && quest ? [toQuestView(quest, row, progressOf(quest, row))] : [];
    });
    return { quests, combatTier: combatTierView(findSkillLevels(db, playerId).combat ?? 1, claimedIds(rows)) };
}

function findHeld(db: Db, playerId: string, questId: string): { quest: QuestDef; row: QuestRow } {
    const row = db.all<QuestRow>(FIND_QUESTS, playerId).find((held) => held.quest_id === questId);
    const quest = CONTENT.quests[questId];
    if (!row || row.claimed_at !== null || !quest) throw AppError.notFound("You don't have that quest");
    return { quest, row };
}

export function trackQuest(db: Db, playerId: string, questId: string) {
    findHeld(db, playerId, questId);
    db.run(SET_TRACKED, playerId, questId);
}

/** Turns in a ready quest and pays its reward. A Trial's tier opens from here on (openTier reads it as claimed). */
export function claimQuest(db: Db, playerId: string, questId: string) {
    const { quest, row } = findHeld(db, playerId, questId);
    if (!isComplete(quest, progressReader(db, playerId)(quest, row))) throw AppError.badRequest("That quest isn't finished yet");
    db.run(CLAIM_QUEST, Date.now(), playerId, questId);
    grantItems(db, playerId, quest.rewards.items);
    addCoins(db, playerId, quest.rewards.coins, "quest-reward", questId);
}
