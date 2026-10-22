import type { GeoChestTier, GeoQualityTier, GeoWorldHabitat, GeoWorldWaterKind } from "@geo/shared";
import type { CropDef, FarmEventDef, MutationDef, PestDef, StructureDef } from "./farming";
import type { FishDef, RodStats } from "./fishing";
import type { DungeonLayoutDef, DungeonPoolEntryDef, DungeonRoomSpecDef, DungeonScoreRules } from "../dungeons/dungeon-map";
import type { Action, CardDef, EffectDef, EnemyMove, FoodDef, StatModifier, Stats, StatusDef } from "../engine/engine.types";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** Equipment slot kinds, matching the app's character screen. */
export type EquipKind = "mainHand" | "offHand" | "head" | "chest" | "hands" | "legs" | "feet" | "shoulders" | "cloak" | "belt" | "amulet" | "ring";

/**
 * A weapon's type (dagger) and style (melee), from `data/config/weapons.ts`.
 * Cards name these in `requiresWeapon`.
 */
export type WeaponTags = { type: string; style: string };

/** A label/value row on the app's item detail page, e.g. Speed · Slow. */
export type ItemStat = { label: string; value: string };

/** Fields every item has, for the app to draw it. */
type ItemBase = {
    id: string;
    name: string;
    /** A Game Icons name, as the app's icon set uses. */
    icon: string;
    rarity: Rarity;
    description: string;
    /**
     * Display rows beyond what the server works out itself (stat modifiers
     * become rows on their own). Words only: no rule reads these.
     */
    stats?: ItemStat[];
    /**
     * Passive effects as the app lists them. PLACEHOLDER text for rules not
     * built yet; an effect that is real lives in `effects` and should say
     * so here too.
     */
    effectText?: string[];
    /**
     * What an NPC pays for one, in coins. Also the lowest price it can be
     * listed at on the Market, and the base of every Market fee. Unset falls
     * back to a PLACEHOLDER by rarity (`sellValueOf`) until it's set by hand.
     */
    sellValue?: number;
    /** A quality catch's tier, e.g. a Silver Salmon (`data/fish/`). */
    quality?: GeoQualityTier;
    /**
     * Account-bound: never sold, listed or used in crafting. Every quality
     * fish is. Checked wherever an item would leave its owner.
     */
    soulbound?: boolean;
};

/**
 * Everything a player can own. One union, so the inventory is one table and
 * one list in the app, and each kind adds only what it needs.
 */
export type ItemDef =
    | (ItemBase & {
          kind: "card";
          /** The card this item plays as. */
          cardId: string;
          maxCharges: number;
          /** Fishing cards: whether it raises or lowers a catch's quality odds. */
          finesse?: "raises" | "lowers";
      })
    | (ItemBase & {
          kind: "equipment";
          slot: EquipKind;
          modifiers?: StatModifier[];
          effects?: EffectDef[];
          /** Cards only usable while this is equipped. */
          unlocksCards?: string[];
          /** Skill levels needed to equip it. */
          skills?: { skill: string; level: number }[];
          /** Main-hand weapons: their type and style, which decide what cards they can play. */
          weapon?: WeaponTags;
          /** Off-hand gear: its type, which decides what requiresOffHand cards it can play. */
          offHand?: { type: string };
          /** Fishing rods (the rod slot): what a cast can hook and land. */
          rod?: RodStats;
      })
    | (ItemBase & {
          /** Counts only while in the Talisman Bag, one copy per talisman; never equipped. */
          kind: "talisman";
          modifiers?: StatModifier[];
          effects?: EffectDef[];
      })
    | (ItemBase & {
          kind: "material";
          skill: string;
          /** How many fit in one inventory stack. */
          stackSize: number;
          /** A compact material: `ratio` of `itemId` pressed into one (`compact` in its file). */
          compactOf?: { itemId: string; ratio: number };
      })
    | (ItemBase & {
          /** Used up from a stack: food in combat Runs, bait in fishing Runs. */
          kind: "consumable";
          stackSize: number;
          /**
           * Food: packed in the lunchbox and eaten in a Run, which takes the
           * turn. `actions` happen to the eater (`self`).
           */
          food?: { tags?: string[]; actions: Action[]; effects?: EffectDef[] };
          /**
           * Bait: packed in the bait slots and used in a fishing Run.
           * PLACEHOLDER: no rule reads `scent` until the fishing Run exists.
           */
          bait?: { scent: number };
      })
    | (ItemBase & {
          /** Keys, Rift Lenses: anything that isn't gear, a card or a material. */
          kind: "misc";
          stackSize: number;
      })
    | (ItemBase & {
          /** One pet at one rarity (`pet.<petId>.<rarity>`); each copy carries its XP and held item. */
          kind: "pet";
          petId: string;
      })
    | (ItemBase & {
          /** Held by a pet (`data/pet-items/`), adding stats or XP. */
          kind: "petItem";
          stackSize: number;
          modifiers?: StatModifier[];
          xpBoost?: { multiplier: number; skill?: string };
      });

/** Kinds that pile into one inventory row rather than one row per copy. */
export function isStackable(item: ItemDef): item is Extract<ItemDef, { stackSize: number }> {
    return "stackSize" in item;
}

/** A pet stat that grows with level: `perLevel` × level (`data/pets/`). */
export type PetStatDef = {
    stat: string;
    kind: "flat" | "percent";
    perLevel: number | Partial<Record<Rarity, number>>;
};

export type PetUpgradeDef = { coins: number; items: ItemAmount[]; hours: number };

/** A pet (`data/pets/`): one item per rarity, stats only, never fights. */
export type PetDef = {
    id: string;
    name: string;
    icon: string;
    /** The app's pet art name. */
    image: string;
    description: string;
    skill: string;
    /** Lowest first. */
    rarities: Rarity[];
    stats: PetStatDef[];
    abilities: { id: string; name: string; from: Rarity; description: string; modifiers: PetStatDef[] }[];
    sellValue?: Partial<Record<Rarity, number>>;
    upgrades?: Partial<Record<Rarity, PetUpgradeDef>>;
};

export type LootEntry = {
    itemId: string;
    /** 0–1. */
    chance: number;
    /** Rolled between these, inclusive. */
    quantity: { min: number; max: number };
};

/** A chest tier: what it's called and what opening one costs. */
export type ChestTierDef = {
    id: GeoChestTier;
    name: string;
    /** Coins to open; 0 is free. */
    cost: number;
};

/** One possible item in a chest pool, picked by weight against the others. */
export type ChestLootEntry = {
    itemId: string;
    weight: number;
    /** Rolled between these, inclusive. */
    quantity: { min: number; max: number };
};

/**
 * A pool rolls `rolls` times, each roll one weighted pick (repeats allowed).
 * A chest is several pools, e.g. one roll from rares as the floor, then 2–4
 * from materials. There is no "nothing" entry: every roll gives an item.
 */
export type ChestLootPool = {
    rolls: { min: number; max: number };
    entries: ChestLootEntry[];
};

/** A chest that may be in the selection: its tier, its chance to appear, and its loot. */
export type ChestOfferDef = {
    tier: GeoChestTier;
    /** 0–1. At least one offer in a reward has 1, so a selection is never empty. */
    chance: number;
    pools: ChestLootPool[];
};

/**
 * A chance that a win gives a chest selection, to pick one from, in place of
 * the loot list. Coins and XP are still given as usual.
 */
export type ChestRewardDef = {
    /** 0–1. */
    chance: number;
    offers: ChestOfferDef[];
};

export type EnemyDef = {
    id: string;
    name: string;
    /** The app's sprite name. */
    sprite: string;
    /** From 1; spawns only for players whose combat level has opened it. */
    tier: number;
    stats: Stats;
    /** A barrier it spawns with, soaking damage before health. */
    barrier?: number;
    moves: EnemyMove[];
    /** Innate effects, e.g. a spider that poisons on hit. */
    effects?: EffectDef[];
    loot: LootEntry[];
    /** A chance of a chest selection instead of `loot`, e.g. for a boss. */
    chests?: ChestRewardDef;
    /** Gone from the map once it has beaten you, rather than waiting to go again. */
    leavesAfterWinning?: boolean;
    /** Coins dropped on a kill, rolled between these, inclusive. */
    coins?: { min: number; max: number };
    /** Combat XP for the kill. */
    xp: number;
    /** Kinds of place it spawns near, by weight; `waters` narrows a water one. */
    habitats?: { near: GeoWorldHabitat; weight: number; waters?: GeoWorldWaterKind[] }[];
};

/** Something a vendor sells. */
export type VendorOffer = {
    itemId: string;
    /** Coins per unit. */
    price: number;
    /** Units left; null is unlimited. Only unlimited is built so far. */
    stock: null;
    /** The buy tab it's under; unset = "Buy". */
    tab?: string;
};

export type VendorDef = {
    id: string;
    name: string;
    /** A Game Icons name. */
    icon: string;
    description: string;
    sells: VendorOffer[];
    /** Coins per reforge by the item's rarity; unset = this vendor doesn't reforge. */
    reforge?: { cost: Record<Rarity, number> };
    /** Raises pets' rarity (Kat). */
    petUpgrades?: boolean;
};

/** A reforge (`data/reforges/`): a named bonus on one copy of a weapon or armor. */
export type ReforgeDef = {
    id: string;
    name: string;
    appliesTo: ("weapon" | "armor")[];
    modifiers: Record<Rarity, StatModifier[]>;
};

/** So many of one item. */
export type ItemAmount = { itemId: string; quantity: number };

/**
 * A crafting recipe: the inputs are used up and the output made, per craft.
 * Skill levels are needed, never spent.
 */
export type RecipeDef = {
    id: string;
    inputs: ItemAmount[];
    output: ItemAmount;
    skills?: { skill: string; level: number }[];
    station?: "cooking";
    xp?: { skill: string; amount: number };
};

/** A mayor's perk: words for the app, and the stats it changes for everyone. */
export type MayorPerkDef = {
    id: string;
    name: string;
    description: string;
    /** A Game Icons name. */
    icon: string;
    modifiers: StatModifier[];
};

export type MayorDef = {
    id: string;
    name: string;
    perks: MayorPerkDef[];
};

export type DungeonDef = {
    id: string;
    name: string;
    description: string;
    boss: string;
    bossModifiers: StatModifier[];
    requiredLevel: number;
    maxPlayers: number;
    /** Star rooms per layout; null while it has no layouts. */
    stars: number | null;
    minibosses: number;
    encounterEnemies: string[];
    starEnemies: string[];
    minibossEnemies: string[];
    chestScores: DungeonScoreRules["chestScores"];
    roomLoot: ChestLootPool[];
    chests: Partial<Record<GeoChestTier, ChestLootPool[]>>;
    penalties: DungeonScoreRules["penalties"];
    roomStyle: string | null;
    rooms: Record<string, DungeonRoomSpecDef>;
    pool: DungeonPoolEntryDef[];
    /** Its hand-drawn maps; empty = a lone boss fight. */
    layouts: DungeonLayoutDef[];
};

/** How a dungeon room's outline is drawn (`data/room-styles/`). */
export type RoomStyleDef = {
    id: string;
    corner: "round" | "chamfer" | "circle";
    radius: number;
    rough: number;
    wall: number;
    inset: number;
    tone: "stone" | "moss" | "ember" | "bone" | "void";
};

export type QuestObjectiveDef =
    | { id: string; type: "kill"; enemy: string; count: number }
    | { id: string; type: "dungeon"; dungeon: string; count: number }
    | { id: string; type: "craft"; recipe: string; count: number }
    | { id: string; type: "camp"; count: number }
    | { id: string; type: "deposit"; count: number };

export type QuestDef = {
    id: string;
    title: string;
    giver: string | null;
    after: string[];
    /** The enemy tier this Trial opens; null for an ordinary quest. */
    unlocksTier: number | null;
    objectives: QuestObjectiveDef[];
    rewards: { coins: number; items: ItemAmount[] };
};

export type GameContent = {
    statuses: Record<string, StatusDef>;
    cards: Record<string, CardDef>;
    /** Built from the items that are food, keyed by item id. */
    foods: Record<string, FoodDef>;
    items: Record<string, ItemDef>;
    /** Pets (`data/pets/`); each also makes a `pet.<id>.<rarity>` item per rarity. */
    pets: Record<string, PetDef>;
    /** Fish that can bite in a fishing Run (`data/fish/`). */
    fish: Record<string, FishDef>;
    /** Crops that grow on the farm (`data/crops/`). */
    crops: Record<string, CropDef>;
    /** Pests that come for the crops (`data/pests/`). */
    pests: Record<string, PestDef>;
    /** Secret crops that sprout from recipes (`data/mutations/`). */
    mutations: Record<string, MutationDef>;
    /** Farm structures (`data/structures/`): built on the farm from their cost, never items. */
    structures: Record<string, StructureDef>;
    /** Farm events (`data/farm-events/`). */
    farmEvents: Record<string, FarmEventDef>;
    enemies: Record<string, EnemyDef>;
    vendors: Record<string, VendorDef>;
    /** Reforges a vendor can roll onto gear (`data/reforges/`). */
    reforges: Record<string, ReforgeDef>;
    mayors: Record<string, MayorDef>;
    /** Raid-style dungeons (`data/dungeons/`). */
    dungeons: Record<string, DungeonDef>;
    /** Every dungeon layout by id (`data/dungeon-layouts/`); each is also in its dungeon's `layouts`. */
    dungeonLayouts: Record<string, DungeonLayoutDef>;
    /** Room outline styles (`data/room-styles/`). */
    roomStyles: Record<string, RoomStyleDef>;
    /** Quests (`data/quests/`). */
    quests: Record<string, QuestDef>;
    recipes: Record<string, RecipeDef>;
    chestTiers: Record<GeoChestTier, ChestTierDef>;
};
