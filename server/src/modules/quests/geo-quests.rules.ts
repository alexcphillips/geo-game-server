import type { GeoCombatTier, GeoQuestObjective } from "@geo/shared";
import { CONTENT, GAME_CONFIG, type GameContent, type QuestDef } from "../../content";
import type { QuestObjectiveDef } from "../../content/content.types";

/** Objective id → how many so far, capped at its count. */
export type QuestProgress = Record<string, number>;

/** Something that happened that a quest may count. */
export type QuestEvent =
    | { type: "kill"; enemyId: string }
    | { type: "dungeon"; dungeonId: string }
    | { type: "craft"; recipeId: string; times: number };

/**
 * What the player has done, whenever it was: camp and deposit objectives
 * count from this, so placing camp or banking before the quest still counts.
 */
export type QuestHistory = { campPlaced: boolean; deposited: number };

const UNLOCK_LEVELS = GAME_CONFIG.spawns.tierUnlockLevels;

/** The Trial that gates `tier`, if it has one. */
export function trialFor(tier: number, content: GameContent = CONTENT): QuestDef | undefined {
    return Object.values(content.quests).find((quest) => quest.unlocksTier === tier);
}

/**
 * The highest enemy tier open to a player: each tier needs its combat level
 * and, if it has a Trial, that Trial turned in. Tiers open in order, so a
 * missing Trial holds back every tier above it too.
 */
export function openTier(
    combatLevel: number,
    claimed: ReadonlySet<string>,
    content: GameContent = CONTENT,
    unlockLevels: readonly number[] = UNLOCK_LEVELS,
): number {
    let tier = 1;
    for (let next = 2; next <= unlockLevels.length; next++) {
        if (combatLevel < unlockLevels[next - 1]!) break;
        const trial = trialFor(next, content);
        if (trial && !claimed.has(trial.id)) break;
        tier = next;
    }
    return tier;
}

/** The open tier, and what the next one still needs. */
export function combatTierView(
    combatLevel: number,
    claimed: ReadonlySet<string>,
    content: GameContent = CONTENT,
    unlockLevels: readonly number[] = UNLOCK_LEVELS,
): GeoCombatTier {
    const tier = openTier(combatLevel, claimed, content, unlockLevels);
    if (tier >= unlockLevels.length) return { tier, next: null };
    const level = unlockLevels[tier]!;
    const trial = trialFor(tier + 1, content);
    return {
        tier,
        next: {
            tier: tier + 1,
            level,
            levelMet: combatLevel >= level,
            trial: trial ? { questId: trial.id, title: trial.title, done: claimed.has(trial.id) } : null,
        },
    };
}

/**
 * Quests the player should be given now: not held before, every quest
 * `after` turned in, and for a Trial, the tier below it open.
 */
export function questsToGive(
    held: ReadonlySet<string>,
    claimed: ReadonlySet<string>,
    tier: number,
    content: GameContent = CONTENT,
): QuestDef[] {
    return Object.values(content.quests).filter(
        (quest) =>
            !held.has(quest.id) &&
            quest.after.every((id) => claimed.has(id)) &&
            (quest.unlocksTier === null || tier >= quest.unlocksTier - 1),
    );
}

/** How much `event` adds to `objective`. */
function stepFor(objective: QuestObjectiveDef, event: QuestEvent): number {
    switch (objective.type) {
        case "kill":
            return event.type === "kill" && event.enemyId === objective.enemy ? 1 : 0;
        case "dungeon":
            return event.type === "dungeon" && event.dungeonId === objective.dungeon ? 1 : 0;
        case "craft":
            return event.type === "craft" && event.recipeId === objective.recipe ? event.times : 0;
        case "camp":
        case "deposit":
            return 0; // Counted from QuestHistory (withHistory).
    }
}

/** Whether the quest has objectives counted from QuestHistory. */
export function needsHistory(quest: QuestDef): boolean {
    return quest.objectives.some((objective) => objective.type === "camp" || objective.type === "deposit");
}

/** `progress` with its camp and deposit objectives counted from `history`. */
export function withHistory(quest: QuestDef, progress: QuestProgress, history: QuestHistory): QuestProgress {
    let next = progress;
    for (const objective of quest.objectives) {
        const done =
            objective.type === "camp" ? (history.campPlaced ? 1 : 0) : objective.type === "deposit" ? history.deposited : null;
        if (done === null) continue;
        const value = Math.max(progress[objective.id] ?? 0, Math.min(objective.count, done));
        if (value !== (progress[objective.id] ?? 0)) next = { ...next, [objective.id]: value };
    }
    return next;
}

/** The quest's progress once `events` are counted, or null if none of them count. */
export function progressAfter(quest: QuestDef, progress: QuestProgress, events: readonly QuestEvent[]): QuestProgress | null {
    let next: QuestProgress | null = null;
    for (const objective of quest.objectives) {
        const before: number = next?.[objective.id] ?? progress[objective.id] ?? 0;
        const step = events.reduce((sum, event) => sum + stepFor(objective, event), 0);
        const after = Math.min(objective.count, before + step);
        if (after !== before) next = { ...(next ?? progress), [objective.id]: after };
    }
    return next;
}

export function isComplete(quest: QuestDef, progress: QuestProgress): boolean {
    return quest.objectives.every((objective) => (progress[objective.id] ?? 0) >= objective.count);
}

/** Enemies the quest still needs killed, for spawns to pull toward. */
export function killTargets(quest: QuestDef, progress: QuestProgress): string[] {
    return quest.objectives.flatMap((objective) =>
        objective.type === "kill" && (progress[objective.id] ?? 0) < objective.count ? [objective.enemy] : [],
    );
}

/** "Kill Giant River Crab", "Complete Slime Pits", "Cook Grilled Salmon", "Place your camp", "Deposit coins in the bank". */
export function objectiveLabel(objective: QuestObjectiveDef, content: GameContent = CONTENT): string {
    switch (objective.type) {
        case "kill":
            return `Kill ${content.enemies[objective.enemy]?.name ?? objective.enemy}`;
        case "dungeon":
            return `Complete ${content.dungeons[objective.dungeon]?.name ?? objective.dungeon}`;
        case "craft": {
            const recipe = content.recipes[objective.recipe];
            const output = recipe ? (content.items[recipe.output.itemId]?.name ?? recipe.output.itemId) : objective.recipe;
            return `${recipe?.station === "cooking" ? "Cook" : "Craft"} ${output}`;
        }
        case "camp":
            return "Place your camp";
        case "deposit":
            return "Deposit coins in the bank";
    }
}

export function objectiveViews(quest: QuestDef, progress: QuestProgress, content: GameContent = CONTENT): GeoQuestObjective[] {
    return quest.objectives.map((objective) => ({
        id: objective.id,
        label: objectiveLabel(objective, content),
        current: Math.min(progress[objective.id] ?? 0, objective.count),
        target: objective.count,
    }));
}
