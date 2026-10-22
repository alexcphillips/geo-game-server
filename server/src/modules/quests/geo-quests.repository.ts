import type { GeoQuestsResponse, GeoQuestView } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { CONTENT, type QuestDef } from "../../content";
import type { TxQuery } from "../../db/transaction";
import * as playerRepository from "../player/geo-player.repository";
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
} from "./geo-quests.rules";
import {
    CLAIM_QUEST,
    FIND_OPEN_QUESTS_FOR_UPDATE,
    FIND_QUEST_FOR_UPDATE,
    FIND_QUEST_HISTORY,
    FIND_QUESTS,
    INSERT_QUEST,
    SET_PROGRESS,
    SET_TRACKED,
} from "./geo-quests.sql";
import type { QuestRow } from "./geo-quests.types";

async function combatLevelOf(tx: TxQuery, playerId: string): Promise<number> {
    return (await playerRepository.findSkillLevels(tx, playerId)).combat ?? 1;
}

const claimedIds = (rows: QuestRow[]) => new Set(rows.filter((row) => row.claimed_at !== null).map((row) => row.quest_id));

/** The highest enemy tier open to the player: combat level and Trials turned in. */
export async function findOpenTier(tx: TxQuery, playerId: string): Promise<number> {
    const rows = await tx<QuestRow>(FIND_QUESTS, [playerId]);
    return openTier(await combatLevelOf(tx, playerId), claimedIds(rows));
}

/** Enemies the player's quests still need killed, for spawns to pull toward. */
export async function findKillTargets(tx: TxQuery, playerId: string): Promise<string[]> {
    const rows = await tx<QuestRow>(FIND_QUESTS, [playerId]);
    const targets = rows.flatMap((row) => {
        const quest = CONTENT.quests[row.quest_id];
        return row.claimed_at === null && quest ? killTargets(quest, row.progress) : [];
    });
    return [...new Set(targets)];
}

/**
 * Gives the player every quest now due (see questsToGive). The first given
 * is tracked when nothing else is, so a new player's tracker shows it.
 */
async function giveQuests(tx: TxQuery, playerId: string): Promise<void> {
    const rows = await tx<QuestRow>(FIND_QUESTS, [playerId]);
    const claimed = claimedIds(rows);
    const due = questsToGive(new Set(rows.map((row) => row.quest_id)), claimed, openTier(await combatLevelOf(tx, playerId), claimed));
    let tracking = !rows.some((row) => row.claimed_at === null && row.tracked);
    for (const quest of due) {
        await tx(INSERT_QUEST, [playerId, quest.id, tracking]);
        tracking = false;
    }
}

/**
 * Counts `events` toward every quest the player holds, in the caller's
 * transaction: a won fight's kills, a recipe made. Quests due
 * are given first, so a new player's first kill counts.
 */
export async function recordQuestEvents(tx: TxQuery, playerId: string, events: QuestEvent[]): Promise<void> {
    if (events.length === 0) return;
    await giveQuests(tx, playerId);
    for (const row of await tx<QuestRow>(FIND_OPEN_QUESTS_FOR_UPDATE, [playerId])) {
        const quest = CONTENT.quests[row.quest_id];
        const next = quest && progressAfter(quest, row.progress, events);
        if (next) await tx(SET_PROGRESS, [playerId, row.quest_id, JSON.stringify(next)]);
    }
}

async function findHistory(tx: TxQuery, playerId: string): Promise<QuestHistory> {
    const [row] = await tx<{ camp_placed: boolean; deposited: string }>(FIND_QUEST_HISTORY, [playerId]);
    return { campPlaced: row?.camp_placed ?? false, deposited: Number(row?.deposited ?? 0) };
}

/**
 * A held quest's progress, with camp and deposit objectives counted from
 * what the player has done (QuestHistory), so doing them before the quest
 * was given counts. `history` is fetched only if the quest needs it.
 */
async function progressOf(quest: QuestDef, row: QuestRow, history: () => Promise<QuestHistory>): Promise<QuestProgress> {
    return needsHistory(quest) ? withHistory(quest, row.progress, await history()) : row.progress;
}

/** Fetches history at most once, on first use. */
function lazyHistory(tx: TxQuery, playerId: string): () => Promise<QuestHistory> {
    let history: Promise<QuestHistory> | undefined;
    return () => (history ??= findHistory(tx, playerId));
}

function toQuestView(quest: QuestDef, row: QuestRow, progress: QuestProgress): GeoQuestView {
    return {
        id: quest.id,
        title: quest.title,
        giver: quest.giver,
        status: isComplete(quest, progress) ? "ready" : "active",
        objectives: objectiveViews(quest, progress),
        tracked: row.tracked,
        startedAt: row.started_at.toISOString(),
        unlocksTier: quest.unlocksTier,
        rewards: quest.rewards,
    };
}

/** Gives any quests due, then lists those held (quests gone from the content are left out). */
export async function listQuests(tx: TxQuery, playerId: string): Promise<GeoQuestsResponse> {
    await giveQuests(tx, playerId);
    const rows = await tx<QuestRow>(FIND_QUESTS, [playerId]);
    const history = lazyHistory(tx, playerId);
    const quests: GeoQuestView[] = [];
    // One after another: `tx` may be a transaction's single connection.
    for (const row of rows) {
        const quest = CONTENT.quests[row.quest_id];
        if (row.claimed_at !== null || !quest) continue;
        quests.push(toQuestView(quest, row, await progressOf(quest, row, history)));
    }
    return { quests, combatTier: combatTierView(await combatLevelOf(tx, playerId), claimedIds(rows)) };
}

export async function trackQuest(tx: TxQuery, playerId: string, questId: string): Promise<void> {
    const [row] = await tx<QuestRow>(FIND_QUEST_FOR_UPDATE, [playerId, questId]);
    if (!row || row.claimed_at !== null || !CONTENT.quests[questId]) throw AppError.notFound("You don't have that quest");
    await tx(SET_TRACKED, [playerId, questId]);
}

/**
 * Turns in a ready quest and pays its reward. The caller holds the player
 * lock. A Trial's tier opens from here on (openTier reads it as claimed).
 */
export async function claimQuest(tx: TxQuery, playerId: string, questId: string): Promise<void> {
    const [row] = await tx<QuestRow>(FIND_QUEST_FOR_UPDATE, [playerId, questId]);
    const quest = CONTENT.quests[questId];
    if (!row || row.claimed_at !== null || !quest) throw AppError.notFound("You don't have that quest");
    const progress = await progressOf(quest, row, lazyHistory(tx, playerId));
    if (!isComplete(quest, progress)) throw AppError.badRequest("That quest isn't finished yet");

    await tx(CLAIM_QUEST, [playerId, questId]);
    await playerRepository.grantItems(tx, playerId, quest.rewards.items);
    await playerRepository.addCoins(tx, playerId, quest.rewards.coins, "quest-reward", questId);
}
