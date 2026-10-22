import type { GeoRecipe, GeoSkillRequirement } from "./crafting.contract";
import type { GeoQualityTier } from "./fishing.contract";

export type GeoRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** Rods are held in the main hand, like weapons: fishing needs one there. */
export type GeoEquipKind = "mainHand" | "offHand" | "head" | "chest" | "hands" | "legs" | "feet" | "shoulders" | "cloak" | "belt" | "amulet" | "ring";

/** Equipment slot ids on the character screen; rings take either of two. */
export type GeoEquipmentSlot =
    | "mainHand"
    | "offHand"
    | "head"
    | "chest"
    | "hands"
    | "legs"
    | "feet"
    | "shoulders"
    | "cloak"
    | "belt"
    | "amulet"
    | "ring1"
    | "ring2";

export const GEO_EQUIPMENT_SLOTS: readonly GeoEquipmentSlot[] = [
    "mainHand",
    "offHand",
    "head",
    "chest",
    "hands",
    "legs",
    "feet",
    "shoulders",
    "cloak",
    "belt",
    "amulet",
    "ring1",
    "ring2",
];

/** Which kind of item each slot takes. */
export function geoSlotKind(slot: GeoEquipmentSlot): GeoEquipKind {
    return slot.startsWith("ring") ? "ring" : (slot as GeoEquipKind);
}

export type GeoItemKind = "card" | "equipment" | "talisman" | "material" | "consumable" | "misc" | "pet" | "petItem";

/** A label/value row on the item detail page, e.g. Defense · +6. */
export type GeoItemStat = { label: string; value: string };

/** An item as the app draws it. Rules (effects, modifiers) stay server-side. */
export type GeoItemView = {
    id: string;
    kind: GeoItemKind;
    name: string;
    /** A Game Icons name; the app falls back to a plain icon for one it lacks. */
    icon: string;
    rarity: GeoRarity;
    description: string;
    /** Stat modifiers as rows, then any extra rows the content gives. */
    stats: GeoItemStat[];
    /** Passive effects, as sentences. */
    effects: string[];
    /** Cards: the skill whose hand it goes in. Materials: its skill sub-tab. */
    skill?: string;
    /** Cards. */
    maxCharges?: number;
    /** Equipment. */
    slot?: GeoEquipKind;
    /** A fishing rod: main-hand gear that isn't a weapon. */
    rod?: true;
    /** Equipment: names of the cards it makes available while worn. */
    unlocksCards?: string[];
    /** Equipment: skill levels needed to equip it. The server refuses without them. */
    skills?: GeoSkillRequirement[];
    /** Weapons and armor: which reforges it takes (`GeoReforgeView.appliesTo`). */
    reforgeTarget?: GeoReforgeTarget;
    /** Consumables that are food: packable in the lunchbox and eaten in a Run. */
    food?: { tags: string[] };
    /** Consumables that are bait: packable in the bait slots and used in a fishing Run. */
    bait?: boolean;
    /** Seeds: the crop they grow into. Planted straight from the inventory. */
    seedOf?: string;
    /** A quality catch's tier, e.g. a Silver Salmon. */
    quality?: GeoQualityTier;
    /** Account-bound: can't be traded, sold or listed, or used in crafting. */
    soulbound?: boolean;
    /** Fishing cards: whether playing it raises or lowers a catch's quality odds. */
    finesse?: "raises" | "lowers";
    /** Pets: which pet, its art (`features/items/art/pets/<image>.png` in the app), and the skill it levels fastest from. */
    pet?: { petId: string; image: string; skill: string };
    /**
     * What an NPC pays for one, in coins: the lowest Market price per unit,
     * and the base of the Market's fees (`market.contract`).
     */
    sellValue: number;
};

/**
 * One way an item is normally obtained, besides crafting (recipes say that
 * themselves). New kinds (dungeon chests) join this union.
 */
export type GeoItemSource =
    | {
          kind: "enemy";
          itemId: string;
          /** The enemy's name, e.g. Giant Spider. */
          name: string;
          /** 0–1, per kill. */
          chance: number;
          /** Rolled between these, inclusive. */
          quantity: { min: number; max: number };
      }
    | {
          kind: "vendor";
          itemId: string;
          /** The vendor's name, e.g. Farmer. */
          name: string;
      };

export type GeoReforgeTarget = "weapon" | "armor";

/**
 * A reforge a vendor can roll onto one copy of a weapon or armor
 * (`GeoInventoryEntry.reforge`). Its name goes before the item's.
 */
export type GeoReforgeView = {
    id: string;
    name: string;
    appliesTo: GeoReforgeTarget[];
    /** Its stat rows on an item of each rarity, e.g. Defense +2, Speed -1. */
    stats: Record<GeoRarity, GeoItemStat[]>;
};

/** `GET /geo/content`: every item definition, for names and icons; every recipe; every item source; every reforge. */
export type GeoContentResponse = {
    items: GeoItemView[];
    recipes: GeoRecipe[];
    sources: GeoItemSource[];
    reforges: GeoReforgeView[];
};
