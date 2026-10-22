import type { GeoItemStat, GeoRarity } from "./content.contract";

/**
 * Pets, like Hypixel SkyBlock's: one is active at a time and gives stats
 * (never fighting). A copy levels from the skill XP its owner earns while
 * it's active — fully from its own skill, a share from the rest — and Kat
 * raises its rarity, keeping its XP. The server works out every number, so
 * the app only draws what it's sent.
 */

/** A stat ability, and whether this copy's rarity has it yet. */
export type GeoPetAbility = {
    name: string;
    description: string;
    /** What it gives at this level, e.g. Defense · +3%. Empty while locked. */
    stats: GeoItemStat[];
    /** The lowest rarity that has it. */
    from: GeoRarity;
    unlocked: boolean;
};

/** Kat's price, now, to raise this copy one rarity. */
export type GeoPetUpgradeQuote = {
    /** The item it comes back as, e.g. `pet.tarantula.uncommon`. */
    toItemId: string;
    coins: number;
    items: { itemId: string; quantity: number }[];
    hours: number;
};

/** One pet copy's progress and what it gives right now. */
export type GeoPetState = {
    level: number;
    maxLevel: number;
    /** Total XP; it carries over when Kat raises the rarity (the level may drop). */
    xp: number;
    /** XP within this level, and what it needs. 0 / 0 at the max. */
    xpIntoLevel: number;
    xpForLevel: number;
    /** The held pet item's item id, or null. */
    heldItem: string | null;
    /** Stats from its level and its held item, as rows. */
    stats: GeoItemStat[];
    abilities: GeoPetAbility[];
    /** null at its highest rarity. */
    upgrade: GeoPetUpgradeQuote | null;
};

/** A pet left with Kat. It's out of the inventory until collected. */
export type GeoPetUpgrade = {
    /** The copy's id; it keeps it when it comes back. */
    inventoryId: string;
    itemId: string;
    toItemId: string;
    /** It can be collected from then. */
    readyAt: string;
};

/** `PUT /geo/me/pet`: makes a pet copy the active one; null puts it away. Replies with `GeoMeResponse`. */
export type GeoSetActivePetRequest = {
    inventoryId: string | null;
};

/**
 * `PUT /geo/me/pets/:inventoryId/item`: the pet holds this pet item (one of
 * the stack is used up). One it already held comes back. `DELETE` takes the
 * held item off for `GeoPetsInfo.heldItemRemovalCost` coins. Both reply with
 * `GeoMeResponse`.
 */
export type GeoPetItemRequest = {
    /** The pet item's inventory row. */
    inventoryId: string;
};

/** `POST /geo/vendors/:vendorId/pet-upgrade`: leaves a pet with Kat, paying her price. Replies with `GeoMeResponse`. */
export type GeoPetUpgradeRequest = {
    inventoryId: string;
};
