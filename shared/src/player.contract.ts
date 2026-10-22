import type { GeoPlayer } from "./auth.contract";
import type { GeoEquipmentSlot, GeoItemStat, GeoRarity } from "./content.contract";
import type { GeoPoint } from "./distance";
import type { GeoPetState, GeoPetUpgrade } from "./pet.contract";
import type { GeoLunchboxSlot } from "./run.contract";
import type { GeoWardrobe } from "./wardrobe.contract";

/** One owned copy (or stack) of an item. */
export type GeoInventoryEntry = {
    id: string;
    itemId: string;
    quantity: number;
    /** Cards only; 0 = faded. */
    chargesLeft: number | null;
    /** Weapons and armor: its reforge id (`GeoReforgeView`), or null. */
    reforge: string | null;
    /** Pets: its level, held item and what it gives; null for anything else. */
    pet: GeoPetState | null;
    obtainedAt: string;
};

/** `GET /geo/me`: everything the app needs on launch. */
export type GeoMeResponse = {
    player: GeoPlayer;
    inventory: GeoInventoryEntry[];
    /** Slot → inventory entry id. */
    equipment: Partial<Record<GeoEquipmentSlot, string>>;
    talismanBag: GeoTalismanBag;
    /** Skill → inventory entry ids, in hand order. */
    hands: Record<string, string[]>;
    /** Skill → total XP. */
    skillXp: Record<string, number>;
    savedHands: GeoSavedHand[];
    lunchbox: GeoLunchbox;
    bait: GeoBait;
    health: GeoHealth;
    /** null until the player sets one. */
    camp: GeoCamp | null;
    /** The active pet's inventory id, or null. */
    activePet: string | null;
    /** The pet left with Kat, or null. */
    petUpgrade: GeoPetUpgrade | null;
    /** Coins to take a held item off a pet, by the held item's rarity. */
    heldItemRemovalCost: Record<GeoRarity, number>;
    /** Every stat the player has now, for the character's Stats tab. */
    stats: GeoStatLine[];
    wardrobe: GeoWardrobe;
};

export type GeoStatGroup = "combat" | "fishing" | "farming";

/**
 * One stat's total, summed the way the server's rules read it, and where it
 * comes from: base first, then each source that changes it, e.g.
 * Base +0, Equipment +10, Talismans +3, Pet +1.
 */
export type GeoStatLine = {
    id: string;
    group: GeoStatGroup;
    label: string;
    /** What the stat does, in a sentence. */
    description: string;
    /** The total as shown: "12", "7%", "×0.75". */
    value: string;
    sources: GeoItemStat[];
};

/**
 * The player's health between fights. It carries from one fight to the next
 * and doesn't regenerate: only lunchbox food (in a fight, or between fights
 * with `POST /geo/me/lunchbox/:slot/eat`) refills it. There is no resting.
 * Fleeing keeps the damage taken.
 * Losing a fight leaves GEO_DEFEAT_HEALTH_FRACTION of max. Dungeon Runs are
 * fought at full health and leave this as it was.
 */
export type GeoHealth = {
    current: number;
    /** From the player's gear right now; `current` is never above it. */
    max: number;
};

/** What's left of max health after losing a fight: rounded up, at least 1. */
export const GEO_DEFEAT_HEALTH_FRACTION = 0.1;

/**
 * Where the player restocks: the lunchbox and bait slots can only be packed
 * within GEO_CAMP_RADIUS_METRES of it. It never expires: it stays until the
 * player sets a new one.
 * Stored rounded (GEO_CAMP_DECIMALS), never as the exact point given.
 */
export type GeoCamp = {
    position: GeoPoint;
    /** When it was last set; it can be moved again from `movableAt`. */
    setAt: string;
    movableAt: string;
};

/** Camp is stored to this many decimal places: about 11 m, so it moves at most ~8 m. */
export const GEO_CAMP_DECIMALS = 4;

/** How close counts as at camp. Covers the rounding with room for GPS drift. PLACEHOLDER. */
export const GEO_CAMP_RADIUS_METRES = 75;

/** Days before a camp can be moved again. */
export const GEO_CAMP_MOVE_DAYS = 2;

/** `PUT /geo/me/camp`: camp becomes (about) here. */
export type GeoSetCampRequest = {
    position: GeoPoint;
};

/**
 * `POST /geo/me/bank/deposit` and `/withdraw`: moves whole coins between the
 * purse and the bank. Only at camp, and not mid-Run, so coins can't be saved
 * from a fight that's going badly. Replies with `GeoMeResponse`.
 */
export type GeoBankRequest = {
    amount: number;
    position: GeoPoint;
};

/**
 * Food packed for Runs: each slot holds a stack of one food, and no food is in
 * two slots. Packed food has left the inventory (it can't be sold or crafted)
 * until it's unpacked or eaten. Can't change mid-Run. Only packed food can be
 * eaten, in a fight or between fights; between fights only its effect on
 * health counts (harm stops at 1 HP), not its buffs or statuses.
 */
export type GeoLunchbox = {
    /** Slots unlocked: starts at 1, up to GEO_LUNCHBOX_MAX_SLOTS. */
    slots: number;
    contents: GeoLunchboxSlot[];
};

/** Most lunchbox slots a player can unlock. */
export const GEO_LUNCHBOX_MAX_SLOTS = 4;

/** Most of one food a lunchbox slot holds. PLACEHOLDER. */
export const GEO_LUNCHBOX_STACK_SIZE = 10;

/**
 * `PUT /geo/me/lunchbox/:slot`: the slot now holds this many of this food.
 * Packing is restocking, so only at camp: `position` is checked against it.
 * Unpacking (DELETE) works anywhere.
 */
export type GeoPackLunchboxRequest = {
    itemId: string;
    quantity: number;
    position: GeoPoint;
};

/**
 * Bait packed for fishing Runs, slotted like the lunchbox: each slot holds a
 * stack of one bait, no bait is in two slots, and packed bait has left the
 * inventory until it's unpacked or used.
 */
export type GeoBait = {
    /** Slots unlocked: starts at 1, up to GEO_BAIT_MAX_SLOTS. */
    slots: number;
    contents: GeoBaitSlot[];
};

/** One bait slot: a stack of one bait. Same shape as a lunchbox slot. */
export type GeoBaitSlot = GeoLunchboxSlot;

/** Most bait slots a player can unlock. */
export const GEO_BAIT_MAX_SLOTS = 4;

/** Most of one bait a slot holds: one goes per cast, so more than food. PLACEHOLDER. */
export const GEO_BAIT_STACK_SIZE = 25;

/** `PUT /geo/me/bait/:slot`: the slot now holds this many of this bait. */
export type GeoPackBaitRequest = GeoPackLunchboxRequest;

/**
 * Only talismans in the bag count in a fight, and it holds one copy of each.
 * One taken out stays in the inventory, inactive. Holds `pages` ×
 * GEO_TALISMAN_BAG_PAGE_SIZE.
 */
export type GeoTalismanBag = {
    /** Starts at 1; more are bought from a vendor. */
    pages: number;
    inventoryIds: string[];
};

/** Talismans per bag page: the app's 5 × 5 grid. */
export const GEO_TALISMAN_BAG_PAGE_SIZE = 25;

/** The error when adding to a full bag; the app shows it as a toast. */
export const GEO_TALISMAN_BAG_FULL = "Your Talisman Bag is full";

/** `PUT /geo/me/equipment/:slot`. null empties the slot. */
export type GeoEquipRequest = {
    inventoryId: string | null;
};

/** `PUT /geo/me/hands/:skill`. */
export type GeoSetHandRequest = {
    inventoryIds: string[];
};

export type GeoSavedHand = {
    id: string;
    skill: string;
    name: string;
    inventoryIds: string[];
    createdAt: string;
};

/** `POST /geo/me/saved-hands`: saves the skill's current hand under a name. */
export type GeoSaveHandRequest = {
    skill: string;
    name: string;
};

/** How many cards a hand holds. Matches the app's HAND_SIZE. */
export const GEO_HAND_SIZE = 5;
