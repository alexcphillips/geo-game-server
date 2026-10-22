/**
 * Quests: a player's active quests and how far along each one is.
 *
 * The server counts progress (a kill, a dungeon won, a recipe made, coins
 * banked) and writes each objective's label, so a new kind of objective needs
 * no app change: the app draws `label (current/target)`. Only what happens
 * while a quest is held counts. When every objective is met the quest is
 * `ready` and waits to be turned in for its reward; turned-in quests leave
 * the list.
 *
 * Quests are given automatically: each once the quests before it are turned
 * in. A Trial (`unlocksTier`) is the gate-quest for an enemy tier: that tier
 * opens only with the combat level for it AND its Trial turned in.
 */

/** One thing to do, e.g. Kill Green Slime (10/25). */
export type GeoQuestObjective = {
    id: string;
    /** What to do, without the count: "Kill Green Slime". */
    label: string;
    current: number;
    target: number;
};

/** `active` while objectives remain; `ready` once all are met, until claimed. */
export type GeoQuestStatus = "active" | "ready";

export type GeoQuestRewards = {
    coins: number;
    items: { itemId: string; quantity: number }[];
};

export type GeoQuestView = {
    id: string;
    title: string;
    /** Who gave it, e.g. "The Angler"; null for quests with no giver. */
    giver: string | null;
    status: GeoQuestStatus;
    objectives: GeoQuestObjective[];
    /** The one the player follows: shown in the HUD tracker when it's collapsed. */
    tracked: boolean;
    /** ISO time it was taken. Orders quests of the same status, oldest first. */
    startedAt: string;
    /** The enemy tier this Trial opens when turned in; null for an ordinary quest. */
    unlocksTier: number | null;
    /** Paid on turn-in. A Trial may pay nothing but its tier. */
    rewards: GeoQuestRewards;
};

/** What stands between the player and the next enemy tier. */
export type GeoCombatTierNext = {
    tier: number;
    /** The combat level it needs, and whether the player has it. */
    level: number;
    levelMet: boolean;
    /** Its Trial, if it has one, and whether it's been turned in. */
    trial: { questId: string; title: string; done: boolean } | null;
};

export type GeoCombatTier = {
    /** The highest enemy tier open to the player: 1 or more. */
    tier: number;
    /** Null at the top tier. */
    next: GeoCombatTierNext | null;
};

/**
 * `GET /geo/quests`, and the reply to tracking or turning one in: every quest
 * held and not yet turned in, and the player's enemy tier.
 */
export type GeoQuestsResponse = {
    quests: GeoQuestView[];
    combatTier: GeoCombatTier;
};
