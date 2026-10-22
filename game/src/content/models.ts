import type { GeoChestTier, GeoFarmGround, GeoFarmWeather, GeoFishingTier, GeoLoadoutActivity, GeoQualityTier, GeoWorldHabitat, GeoWorldWaterKind } from "@geo/shared";
import type { Action, Amount, Condition, EffectDef, StatModifier } from "../engine/engine.types";

/**
 * The models for every file in `geo/data/`. A data file imports its model
 * and checks itself against it:
 *
 *     import type { Weapon } from "#geo/models";
 *
 *     export default {
 *         id: "claymore",
 *         …
 *     } satisfies Weapon;
 *
 * so the editor autocompletes every field, explains it on hover, and
 * underlines a mistake as you type. `npm run typecheck` checks them all.
 * The server checks every file again when it loads it (`data.schema.ts`,
 * kept in step with these types by the compiler), plus the references
 * between files.
 */

export type { Action, Amount, Condition, StatModifier };
/** A passive rule: when `trigger`, if `conditions`, `chance` of the time, do `actions`. See data/EFFECTS.md. */
export type Effect = EffectDef;

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** A display row on the item page, e.g. `{ label: "Speed", value: "Slow" }`. Words only: no rule reads it. */
export type ItemStat = { label: string; value: string };

/** So many of one item. */
export type ItemAmount = { itemId: string; quantity: number };

/** Inclusive. */
export type Range = { min: number; max: number };

// ---------------------------------------------------------------------------
// Items

/** Fields every item has. */
export type ItemBase = {
    /** Unique across all items. Lower-case letters, digits, dots and dashes. Must match the file name. */
    id: string;
    /** Shown in the app. */
    name: string;
    rarity: Rarity;
    /** A Game Icons name (game-icons.net), e.g. "broadsword". */
    icon: string;
    /** Flavour text. */
    description: string;
    /** Extra rows on the item page. Words only: nothing reads them. Stat modifiers get rows by themselves. */
    stats?: ItemStat[];
    /** Passive effects as the app lists them. Words only. */
    effectText?: string[];
    /**
     * Coins an NPC pays for one. Also the lowest Market price and the base of
     * Market fees. Unset = the rarity placeholder in config/economy.
     */
    sellValue?: number;
};

/** Stats and rules while worn (or, for talismans, while in the bag). */
export type GearRules = {
    /** Stat changes: (base + flat) × (1 + percent). */
    modifiers?: StatModifier[];
    /** Procs and passives. */
    effects?: Effect[];
};

export type EquipmentRules = GearRules & {
    /** Card ids (no `card.`) only usable while this is equipped. */
    unlocksCards?: string[];
    /**
     * Skill levels needed to equip it, e.g. `[{ skill: "combat", level: 5 }]`,
     * however it was got (crafted, bought, looted). Default none.
     */
    skills?: { skill: string; level: number }[];
};

/**
 * A card: its rules and the item players own, in one file. The item's id is
 * `card.<id>`.
 */
export type Card = ItemBase & {
    /** Which hand it goes in: combat, fishing, mining, farming, foraging… */
    skill: string;
    /** Plays before it fades. */
    maxCharges: number;
    /** Who the player aims it at. */
    targets: "enemy" | "self";
    /** What playing it does, in order. Default none. Fishing cards' rules are in code. */
    actions?: Action[];
    /** Card-only rules, heard only when this card is played (e.g. free against Burning). */
    effects?: Effect[];
    /** e.g. "fire", for cardHasTag conditions on gear and statuses. */
    tags?: string[];
    /**
     * Weapon types or styles (config/weapons); the wielded weapon must carry
     * one, e.g. ["dagger"] or ["melee"]. Omit = playable with anything.
     */
    requiresWeapon?: string[];
    /**
     * Off-hand types (config/weapons offHandTypes); the off-hand must be one,
     * e.g. ["shield"]. Omit = no off-hand needed. With requiresWeapon, both
     * must hold.
     */
    requiresOffHand?: string[];
    /**
     * Conditions that must all hold to play it, e.g.
     * `[{ type: "lacksStatus", who: "self", status: "venom-coat" }]` for a
     * self-buff that can't be recast while it lasts. The app greys it out
     * meanwhile. `self` is the player, `other` the target.
     */
    playableIf?: Condition[];
    /** Fishing cards only: whether it raises or lowers catch quality. */
    finesse?: "raises" | "lowers";
};

/** A main-hand weapon. */
export type Weapon = ItemBase &
    EquipmentRules & {
        weapon: {
            /** From config/weapons types, e.g. "dagger". */
            type: string;
            /** From config/weapons styles, e.g. "melee". */
            style: string;
        };
    };

/** Shields (offHand), helmets, shoulders, chest pieces, gloves, leg armor, boots, cloaks, belts. */
export type Armor = ItemBase &
    EquipmentRules & {
        slot: "offHand" | "head" | "chest" | "hands" | "legs" | "feet" | "shoulders" | "cloak" | "belt";
        /** Off-hand slot only: its type, from config/weapons offHandTypes, e.g. "shield". Cards' requiresOffHand names these. */
        offHand?: { type: string };
    };

export type Ring = ItemBase & EquipmentRules;

export type Amulet = ItemBase & EquipmentRules;

/** A fishing rod: worn in the rod slot, it decides what a cast can hook and land. */
export type Rod = ItemBase &
    EquipmentRules & {
        rod: {
            /** Added to the fishing level for Fishing Power: reels faster, tires fish quicker, outclasses small ones. */
            power: number;
            /** Line strength: the Tension cap. The sweet zone scales with it. */
            line: number;
            /** The rarest fish it can hook. Rarer bites re-roll among the rarities it can. */
            maxRarity: Rarity;
            /** The best quality it can land. null: never a quality catch. */
            maxTier: GeoQualityTier | null;
        };
    };

/** Counts only while in the Talisman Bag, one copy each. */
export type Talisman = ItemBase & GearRules;

/** Gathered or looted, crafted with. Crops are farming materials. */
export type Material = ItemBase & {
    /** Its inventory sub-tab, and which vendors buy it. */
    skill: string;
    /** Default 999. */
    stackSize?: number;
    /**
     * Also makes a Compact version, `compact-<id>`, and the recipe pressing
     * `ratio` of this into one. One-way; worth exactly ratio × this.
     */
    compact?: { ratio: number };
};

/** Packed in the lunchbox; eating it in a Run uses the turn. */
export type Food = ItemBase & {
    /** Default 99. A lunchbox slot holds up to 10. */
    stackSize?: number;
    /** Heals the eater this much (never raised by Mending), and adds a Heals row. */
    heal?: number;
    /** e.g. "spicy", for foodHasTag conditions. */
    tags?: string[];
    /** Done to the eater (`self`) after the heal, e.g. applyStatus "well-fed". */
    actions?: Action[];
    /** Food-only rules, heard only as this food is eaten. */
    effects?: Effect[];
};

/** Packed in the bait slots; one per cast. */
export type Bait = ItemBase & {
    /** Default 99. */
    stackSize?: number;
    /** PLACEHOLDER: shown, but no rule reads it yet. */
    scent: number;
    /** Draws sea creatures and makes the bite come sooner. */
    chum?: boolean;
};

/** Keys, nets, lenses: anything else. */
export type MiscItem = ItemBase & {
    /** Which inventory tab. Default "misc"; "consumable" for potions that aren't food. */
    kind?: "misc" | "consumable";
    /** Default 99. */
    stackSize?: number;
};

/**
 * A stat a pet gives that grows with its level: `perLevel` × level. At level
 * 100 a `perLevel` of 0.3 is +30.
 */
export type PetStat = {
    stat: string;
    /** Default "flat". Percent values are fractions: 0.001 per level is +10% at 100. */
    kind?: "flat" | "percent";
    /** One number for every rarity, or one per rarity (a rarity left out gives nothing). */
    perLevel: number | Partial<Record<Rarity, number>>;
};

/** A pet ability: stats from the rarity it unlocks at, growing with level like `stats`. */
export type PetAbility = {
    /** Unique within the pet. */
    id: string;
    name: string;
    /** The lowest rarity that has it; every higher one does too. */
    from: Rarity;
    /** What it does, in words. Its stat rows are added by themselves. */
    description: string;
    modifiers?: PetStat[];
};

/** What Kat charges to raise a pet one rarity. Each pet level takes some off (config/pets). */
export type PetUpgrade = {
    coins: number;
    items?: ItemAmount[];
    /** Real hours the pet stays with Kat. */
    hours: number;
};

/**
 * A pet: gives stats while it's the active one, and never fights. Makes one
 * item per rarity, `pet.<id>.<rarity>`, which is what loot, recipes and
 * vendors name. A copy keeps its XP from one rarity to the next.
 */
export type Pet = {
    /** Must match the file name. */
    id: string;
    name: string;
    /** A Game Icons name, for lists that don't draw the pet's art. */
    icon: string;
    /** The app's pet art: `features/items/art/pets/<image>.png`. */
    image: string;
    description: string;
    /** It gains full XP from this skill's XP, and a share of every other skill's (config/pets). */
    skill: string;
    /** The rarities it comes in, lowest first; Kat raises it through these. */
    rarities: Rarity[];
    stats: PetStat[];
    abilities: PetAbility[];
    /** Coins an NPC pays, by rarity. Unset = the rarity placeholder in config/economy. */
    sellValue?: Partial<Record<Rarity, number>>;
    /** Kat's price to raise it from each rarity. Unset = config/pets `upgrades`. */
    upgrades?: Partial<Record<Rarity, PetUpgrade>>;
};

/**
 * Held by a pet, one per pet, adding to what it gives. Applying one uses it
 * up; swapping hands the old one back, and taking one off costs coins
 * (config/pets).
 */
export type PetItem = ItemBase & {
    /** Stats while a pet holds it and is active. */
    modifiers?: StatModifier[];
    /** Multiplies the pet's XP gain; `skill` limits it to that skill's XP. */
    xpBoost?: { multiplier: number; skill?: string };
    /** Default 64. */
    stackSize?: number;
};

// ---------------------------------------------------------------------------
// Everything else

export type FishIntent = "run" | "thrash" | "dive" | "rest" | "jump";
export type FishTrait = "slippery" | "linebreaker" | "deepdiver";

/** A fish that bites in rod fishing. Makes the items `fish.<id>` and `fish.<id>.<tier>`. */
export type Fish = {
    /** Must match the file name. */
    id: string;
    name: string;
    /** Which waters it bites in, how often, how hard quality is (config/fishing). */
    rarity: Rarity;
    icon: string;
    description: string;
    /** How long it fights. */
    stamina: number;
    /** Scales every move it makes; 1 is normal. */
    strength: number;
    /** Starting Distance; it escapes at this + 5. */
    distance: number;
    /** Weights: how often it picks each move. 0 = never. */
    moves: Record<FishIntent, number>;
    /** Special behaviour, in code. */
    traits?: FishTrait[];
    /** Fishing XP for landing one. */
    xp: number;
};

/**
 * A crop that grows on the farm. Its seed and what it gives are ordinary
 * `farming` materials with files of their own (`materials/farming/`).
 */
export type Crop = {
    /** Must match the file name. */
    id: string;
    name: string;
    icon: string;
    /** The seed item, planted from the inventory. */
    seed: string;
    /** The item a harvest gives. */
    produce: string;
    /** Turns from planting to ripe; a cycle on dry ground doesn't count. */
    stages: number;
    /** How many `produce` one harvest gives, before push bonuses and Farming Fortune. */
    yield: Range;
    /** Seeds back from a harvest. */
    seedsBack: Range;
    /** Farming XP per harvest. */
    xp: number;
};

/**
 * A farm event. Each turn may telegraph one for the next turn (see
 * `config/farming.ts` `events`). Some act on their turn, some last the
 * turn after it.
 */
export type FarmEvent = {
    /** Must match the file name. */
    id: string;
    name: string;
    icon: string;
    description: string;
    /** How often it's the one rolled on a farm, against the others. 0: only ever global (`config/farming.ts` `globalEvents`). */
    weight: number;
    /**
     * What it does. On its turn: `pest-swarm` (`count` extra pests, past
     * the cap), `blood-moon` (recipes can need it;
     * pests `pestBoost` × likelier). For the turn after: `bumper-harvest`
     * (+`bonus` yield on every harvest), `merchant` (`count` picks from
     * `stock` for sale), `meteor-shower` (mutation chances × `mutationBoost`,
     * and `dropChance` per empty tile of `itemId` falling there).
     */
    effect:
        | { kind: "pest-swarm"; count: number }
        | { kind: "blood-moon"; pestBoost: number }
        | { kind: "bumper-harvest"; bonus: number }
        | { kind: "merchant"; count: number; stock: { itemId: string; price: number }[] }
        | { kind: "meteor-shower"; mutationBoost: number; dropChance: number; itemId: string };
};

/**
 * A farm structure. Not an item: it's built straight onto the farm from the
 * farm's Build list (shown once the farming level reaches `requiredLevel`),
 * taking `cost` from the inventory. Demolished, it's gone, with nothing back.
 */
export type Structure = {
    /** Must match the file name. */
    id: string;
    name: string;
    /** A Game Icons name (game-icons.net). */
    icon: string;
    description: string;
    /** Extra lines in the Build list. Words only. */
    stats?: ItemStat[];
    /** Taken from the inventory when it's built; never refunded. */
    cost: ItemAmount[];
    /**
     * The tiles it covers, centred on the tile it's placed from (an even
     * side reaches one further right or down). Every one must be owned and
     * clear. 1×1 when absent.
     */
    size?: { width: number; height: number };
    /** The farming level before it shows in the Build list and can be built. 0 or absent = none; one already built stays. */
    requiredLevel?: number;
    /**
     * What it does. `jukebox`: its tune makes that pest `boost` times
     * likelier to spawn. `cage`: keeps a pest alive, which counts as that pest
     * nearby for mutation recipes. `beehive`: mutation chances × `boost`
     * around it; `swarmChance` each turn the crops around don't grow.
     * `compost`: every `capacity` harvests and clears on the farm make one
     * `itemId` (Compost, for tile unlocks and building). `pond`: the 4
     * tiles beside it are wet ground, and a frog eats 1 pest near it a turn.
     * `greenhouse`: a roof over its footprint, which can go over crops;
     * crops under it get no weather (they grow as on a clear day), no pests
     * arrive there, and no mutations sprout there.
     * `reactor`: crops within `radius` grow `growth` extra stages a turn, but
     * each turn `wasteChance` nuclear waste lands within `radius`.
     * `portal`: Tear the Veil opens it; on the next turn `wave` pests from
     * `pests` come through. `shrine`: takes offerings for blessings
     * (`config/farming.ts` `shrine`). `well`: tiles within `radius` never
     * go dry, even in a heatwave.
     */
    effect:
        | { kind: "jukebox"; boost: number }
        | { kind: "cage" }
        | { kind: "beehive"; boost: number; swarmChance: number }
        | { kind: "compost"; capacity: number; itemId: string }
        | { kind: "pond" }
        | { kind: "greenhouse" }
        | { kind: "reactor"; radius: number; growth: number; wasteChance: number }
        | { kind: "portal"; wave: number; pests: string[] }
        | { kind: "shrine" }
        | { kind: "well"; radius: number };
};

/**
 * A mutation: a fantasy crop that can't be planted. It sprouts on an empty
 * tile when its secret `recipe` is met there on a turn, then grows and
 * harvests like a crop (no seeds back). Its `produce` is an ordinary
 * `farming` material. The first one turned in at the Research Lab records
 * the recipe and pays `research`.
 */
export type Mutation = {
    /** Must match the file name. */
    id: string;
    name: string;
    icon: string;
    description: string;
    /** The item a harvest gives. */
    produce: string;
    /** Turns from sprouting to ripe; a cycle on dry ground doesn't count. */
    stages: number;
    yield: Range;
    /** Farming XP per harvest. */
    xp: number;
    /** Checked around an empty tile on each turn, after growth. Every part given must hold. */
    recipe: {
        /** Ripe crops among the 8 tiles around: at least `count` of each. */
        parents: { cropId: string; count: number }[];
        /** The weather of that turn. */
        weather?: GeoFarmWeather;
        /** A farm event on that turn (`data/farm-events/`), e.g. "blood-moon". */
        event?: string;
        /** A pest of this kind on the tile or one of the 8 around. */
        pest?: string;
        /** A structure of this id on one of the 8 tiles around, e.g. "pond". */
        structure?: string;
        /** A Shrine blessing or curse on the farm that turn, by id (`config/farming.ts` `shrine`), e.g. "pests". */
        blessing?: string;
        /** The empty tile's ground that turn: "wet" or "dry" (`GeoFarmGround`). */
        ground?: GeoFarmGround;
    };
    /** Chance (0–1) it sprouts on a turn where the recipe holds. Hand Pollinate multiplies it. */
    chance: number;
    /** Paid once, for the first one turned in at the Research Lab. */
    research: { coins: number; xp: number };
};

/**
 * A pest: a piece on the farm grid that comes for the crops it likes, shows
 * its next move, and acts each turn. Cleared with Swat or pest cards, each
 * rolling its `drops`.
 */
export type Pest = {
    /** Must match the file name. */
    id: string;
    name: string;
    icon: string;
    description: string;
    /** Crop ids it's drawn to. It only spawns while one of them grows, and goes for them first. May be empty for a Portal or waste pest. */
    likes: string[];
    /**
     * How it acts each turn. `eat`: eats a crop within `reach` tiles (the
     * crop is gone). `sap`: the crop it's on doesn't grow; with none, it
     * moves to one next door. `breed`: the crop it's on doesn't grow, and every `every` turns a
     * new one appears on a crop next door.
     */
    behaviour: { kind: "eat"; reach: number } | { kind: "sap" } | { kind: "breed"; every: number };
    /** How likely it is to be the one that spawns, per liked crop growing. 0: only from a Portal or waste. */
    weight: number;
    /** Hits it takes to clear (Swat and Smoke hit once; traps and frogs only take 1-hit pests). Default 1; more is elite. */
    hp?: number;
    /** Rolled one by one when it's cleared: each lands with its `chance` (0–1). */
    drops: { itemId: string; chance: number; quantity: Range }[];
    /** Farming XP when it's cleared. */
    xp: number;
    /** Pesthunter points for turning it in from a Pest Cage. Default 0 (elites can't be caged). */
    bounty?: number;
};

/** One possible pick in a chest pool, weighted against the others. */
export type ChestEntry = { itemId: string; weight: number; quantity: Range };

/** Rolls `rolls` weighted picks (repeats allowed) from `entries`. */
export type ChestPool = { rolls: Range; entries: ChestEntry[] };

/** A chest that may be in the selection. */
export type ChestOffer = {
    tier: GeoChestTier;
    /** 0–1. At least one offer needs 1, so a selection is never empty. */
    chance: number;
    /** At least one pool needs rolls.min ≥ 1. */
    pools: ChestPool[];
};

export type EnemyMove = {
    id: string;
    /** Shown when it's used. */
    name: string;
    /** Against its other moves: 3 vs 1 = 75% / 25%. */
    weight: number;
    /** What it does. `other` is the player. */
    actions: Action[];
};

export type Enemy = {
    /** Must match the file name. */
    id: string;
    name: string;
    /** The app's sprite name. */
    sprite: string;
    /**
     * How far into the game it belongs, from 1. It only spawns on the map for
     * players whose combat level has opened its tier (`config/spawns.ts`
     * `tierUnlockLevels`).
     */
    tier: number;
    /** maxHealth, attack, defense, speed, critChance… Missing = 0. */
    stats: Record<string, number>;
    /**
     * A barrier it spawns with: soaks this much damage (after guard, before
     * health) until broken. Shown as gold over its health bar.
     */
    barrier?: number;
    /** Each turn it picks one by weight. At least one. */
    moves: EnemyMove[];
    /** Innate rules, e.g. poisons on hit. */
    effects?: Effect[];
    /** Each rolled on its own on a win. chance 0–1. */
    loot?: { itemId: string; chance: number; quantity: Range }[];
    /** A chance of a chest selection instead of `loot`. Coins and XP still come. */
    chests?: { chance: number; offers: ChestOffer[] };
    /** Gone from the map once it has beaten you. */
    leavesAfterWinning?: boolean;
    /** Coins on a kill. */
    coins?: Range;
    /** Combat XP for the kill. */
    xp: number;
    /**
     * Where it spawns on the map besides `config/spawns.ts` `enemies`: near
     * these kinds of place, by weight against the others living there. An
     * entry for water with `waters` only spawns at those kinds of water.
     */
    habitats?: EnemyHabitat[];
};

export type EnemyHabitat = { near: GeoWorldHabitat; weight: number; waters?: GeoWorldWaterKind[] };

/** Burning, Frozen, Well Fed… */
export type Status = {
    /** Must match the file name. */
    id: string;
    name: string;
    /** In the bearer's turns, counting the one it lands on. Omit = until removed. */
    duration?: number;
    /** Reapplying adds stacks up to this; 1 = refreshes instead. */
    maxStacks: number;
    /** Stat changes while it lasts. */
    modifiers?: StatModifier[];
    /** What it does while it lasts. `self` is the bearer. */
    effects?: Effect[];
};

/** Crafting and cooking: inputs used up, output made, per craft. */
export type Recipe = {
    /** Must match the file name. Usually the output's id. */
    id: string;
    /** Used up per craft. Each item once. */
    inputs: ItemAmount[];
    output: ItemAmount;
    /** Levels needed, never spent. Max 50. */
    skills?: { skill: string; level: number }[];
    /** Where it's made: "cooking" lists it on the Cooking menu. Omit for the crafting screen. */
    station?: "cooking";
    /** Skill XP per craft, e.g. `{ skill: "cooking", amount: 5 }`. */
    xp?: { skill: string; amount: number };
};

export type ItemKind = "card" | "equipment" | "talisman" | "material" | "consumable" | "misc" | "pet" | "petItem";

/** An NPC shop. */
export type Vendor = {
    /** Must match the file name. */
    id: string;
    name: string;
    icon: string;
    description: string;
    /**
     * Coins each, unlimited stock. Never under what vendors pay back (every
     * vendor buys anything with a sellValue that isn't Soulbound).
     * `tab` sorts it into a named buy tab ("Weapons"); untabbed offers go
     * under "Buy".
     */
    sells: { itemId: string; price: number; stock?: null; tab?: string }[];
    /**
     * Gives the vendor a Reforge tab: pay this many coins, by the item's
     * rarity, for a random reforge from `data/reforges/` (never the one it has).
     */
    reforge?: { cost: Record<Rarity, number> };
    /** Gives the vendor a Pets tab to raise a pet's rarity, at its `upgrades` price (Kat). */
    petUpgrades?: boolean;
};

/** Which gear a reforge can land on. Armor is the off hand, head, chest, hands, legs, cloak and belt; never rings or amulets. */
export type ReforgeTarget = "weapon" | "armor";

/** A reforge: a named bonus a vendor rolls onto one copy of a weapon or armor, e.g. "Heavy". */
export type Reforge = {
    /** Must match the file name. */
    id: string;
    /** Shown before the item's name: "Heavy Iron Helm". */
    name: string;
    appliesTo: ReforgeTarget[];
    /** Its stat changes on an item of each rarity. */
    modifiers: Record<Rarity, StatModifier[]>;
};

/** A raid-style dungeon: a boss fought from a lobby (`modules/dungeons`). */
export type Dungeon = {
    /** Must match the file name. */
    id: string;
    name: string;
    /** One or two sentences for the lobby menu. */
    description: string;
    /** The enemy fought: its stats, moves, loot and sprite. */
    boss: string;
    /**
     * Makes the boss bigger than it is on the map, e.g.
     * `{ stat: "maxHealth", kind: "percent", value: 2 }` for triple health.
     */
    bossModifiers?: StatModifier[];
    /**
     * The combat level needed to make or join a lobby for it. 0 = none. A
     * host can ask more of their lobby, up to their own level.
     */
    requiredLevel: number;
    /** How many players a lobby holds, host included. */
    maxPlayers: number;
    /**
     * How many star rooms every layout has. Clearing them all opens the
     * boss room. Required once the dungeon has layouts in
     * `data/dungeon-layouts/`; without layouts it's a lone boss fight.
     */
    stars?: number;
    /** How many gold rooms (kind "miniboss") every layout has. Default 0. */
    minibosses?: number;
    /** Enemy ids an encounter room picks from. Required once the dungeon has layouts. */
    encounterEnemies?: string[];
    /** Enemy ids a star room picks from. Required once the dungeon has layouts. */
    starEnemies?: string[];
    /** Enemy ids a gold room picks from. Required when `minibosses` is above 0. */
    minibossEnemies?: string[];
    /**
     * The lowest score (0–100) that offers each chest tier at the end; Plain
     * is always offered. Void also needs no failed puzzle. Default gold 40,
     * ruby 70, void 90.
     */
    chestScores?: { gold?: number; ruby?: number; void?: number };
    /**
     * What a loot room gives each player who collects it, straight into their
     * inventory. Required once its layouts can have loot rooms.
     */
    roomLoot?: ChestPool[];
    /**
     * What each end-of-dungeon chest holds, by tier, as pools like an
     * enemy's chests. A tier left out is never offered; `plain` is required
     * once the dungeon has layouts.
     */
    chests?: Partial<Record<GeoChestTier, ChestPool[]>>;
    /** Points off the score for each failed puzzle and each death. Default 20 and 15. */
    penalties?: { failedPuzzle?: number; death?: number };
    /** The outline style (`data/room-styles/`) for rooms that don't pick their own. */
    roomStyle?: string;
    /** Rooms its layouts, place rules and pool can name, e.g. `{ "inner-sanctum": { kind: "encounter", lock: "sanctum-key" } }`. */
    rooms?: Record<string, DungeonRoom>;
    /**
     * What a layout's leftover slots roll from, by `weight` (default 1), up to
     * `max` times each run. No entrance, star, gold room or boss here: place those.
     */
    pool?: { room: DungeonRoomRef; weight?: number; max?: number }[];
};

/** What a dungeon room holds. See `data/dungeon-layouts/README.md`. */
export type DungeonRoomKind = "entrance" | "encounter" | "star" | "miniboss" | "puzzle" | "loot" | "event" | "boss" | "empty";

/** A dungeon room: its kind, plus an optional name, outline style and lock. */
export type DungeonRoom = {
    kind: DungeonRoomKind;
    /** Shown on the map, e.g. "Inner Sanctum". */
    name?: string;
    /** A `data/room-styles/` id. Default: the layout's, then the dungeon's. */
    style?: string;
    /**
     * The item id of the key that opens it. Every room you can only reach
     * through it becomes a private wing for whoever opens it.
     */
    lock?: string;
};

/** A room kind ("encounter"), one of the dungeon's named `rooms`, or a room written out. */
export type DungeonRoomRef = DungeonRoomKind | (string & {}) | DungeonRoom;

/** A hand-drawn dungeon map. Lives in `data/dungeon-layouts/<dungeon id>/`. */
export type DungeonLayout = {
    /** Must match the file name. */
    id: string;
    /** The dungeon it belongs to. */
    dungeon: string;
    /**
     * The drawing: letters are rooms, digits are slots, `-` and `|` are
     * doors, spaces are walls. Rooms sit on every other column and line.
     * The entrance goes on the bottom line.
     */
    map: string;
    /** What each letter on the map is. */
    rooms: Record<string, DungeonRoomRef>;
    /** Rooms put into one of the listed slots each run, in this order. Without `chance` the room always appears. */
    place?: { room: DungeonRoomRef; at: number[]; chance?: number }[];
    /** Outline style for its rooms; overrides the dungeon's. */
    roomStyle?: string;
    /** Whether a run may flip it left to right. Default true. */
    mirror?: boolean;
};

/** How a dungeon room's outline is drawn. The app draws it from these numbers; no images. */
export type RoomStyle = {
    /** Must match the file name. */
    id: string;
    /** Rounded corners, cut corners, or as round as the room allows. */
    corner: "round" | "chamfer" | "circle";
    /** Corner size in map units (a cell is 64). Default 8. */
    radius?: number;
    /** How jagged the walls are; 0 = straight. Default 0. */
    rough?: number;
    /** Wall thickness. Default 3. */
    wall?: number;
    /** How far the walls sit inside the cell's edge. Default 4. */
    inset?: number;
    /** Floor and wall colours, from a set that works in light and dark mode. */
    tone: "stone" | "moss" | "ember" | "bone" | "void";
};

export type MayorPerk = {
    id: string;
    name: string;
    description: string;
    icon: string;
    /** Stat changes for every player while in office. [] = words only. */
    modifiers: StatModifier[];
};

export type Mayor = {
    /** Must match the file name. */
    id: string;
    name: string;
    perks: MayorPerk[];
};

/**
 * Something to do: "Kill 1 Green Slime". The server counts progress, and the
 * app's label is written from it ("Kill Green Slime"), so a new kind here
 * needs no app change. Only what happens while the quest is held counts,
 * except `camp` and `deposit`, which count what was done before it too.
 */
export type QuestObjective =
    | {
          /** Unique within the quest, e.g. "kill". */
          id: string;
          /** Each of `enemy` defeated in a won fight (a dungeon's boss too). */
          type: "kill";
          enemy: string;
          count: number;
      }
    | {
          id: string;
          /** Each win in `dungeon`. */
          type: "dungeon";
          dungeon: string;
          count: number;
      }
    | {
          id: string;
          /** Each time `recipe` is made: crafting 3 at once counts 3. "Cook …" for a cooking recipe. */
          type: "craft";
          recipe: string;
          count: number;
      }
    | {
          id: string;
          /** Placing a camp, ever (before the quest too). Always 1. */
          type: "camp";
          count: 1;
      }
    | {
          id: string;
          /** Coins put in the bank, added up over every deposit, before the quest too. */
          type: "deposit";
          count: number;
      };

/** What turning in a finished quest pays. */
export type QuestRewards = {
    coins?: number;
    items?: ItemAmount[];
};

export type Quest = {
    /** Must match the file name. */
    id: string;
    title: string;
    /** Who gives it, as the app shows it: "The Angler". Leave out for none. */
    giver?: string;
    /**
     * Quests to turn in first. A quest is given to the player automatically
     * once every one of these is turned in (at once, if none).
     */
    after?: string[];
    /**
     * Makes this a Trial: the gate-quest for enemy tier `unlocksTier`. That
     * tier opens only once the player has the combat level for it
     * (config/spawns.ts tierUnlockLevels) AND has turned this in. It's given
     * once the tier below is open (and its `after` are done). One per tier,
     * 2 or more. A Trial may pay nothing else.
     */
    unlocksTier?: number;
    /** All must be met before it can be turned in. */
    objectives: QuestObjective[];
    rewards: QuestRewards;
};

// ---------------------------------------------------------------------------
// config/

export type PlayerConfig = {
    /** A player's stats before gear: maxHealth, attack, defense, speed, critChance, critMultiplier. */
    baseStats: Record<string, number>;
};

/** Rods are held in the main hand, like weapons. */
export type EquipSlot = "mainHand" | "offHand" | "head" | "chest" | "hands" | "legs" | "feet" | "shoulders" | "cloak" | "belt" | "amulet" | "ring";

export type StarterKitConfig = {
    /** Granted to every new player. Cards are `card.<id>`. */
    items: ItemAmount[];
    /**
     * Saved in the wardrobe on arrival, in slot order; the first is worn.
     * Each item must also be in `items`. `autoFor` tags it for auto-swap
     * (combat's tag only works once auto-swap is bought).
     */
    loadouts: { name: string; autoFor?: GeoLoadoutActivity; equip: Partial<Record<EquipSlot, string>> }[];
    /** Every starter card of these skills becomes that skill's first hand. */
    handSkills: string[];
    /** Packed into the lunchbox, slot by slot. */
    lunchbox: ItemAmount[];
    /** Packed into the bait slots, slot by slot. */
    bait: ItemAmount[];
};

export type SpawnsConfig = {
    /** How far a fight can start, in metres. */
    reachMetres: number;
    /** New spawns land at most this far from the player; below reachMetres to allow for GPS drift. */
    maxSpawnMetres: number;
    /** New spawns land at least this far from the player. */
    minSpawnMetres: number;
    /** How long a spawn lingers once you're out of its reach. */
    outOfReachSeconds: number;
    /** A beaten spawn holds its slot this long. */
    respawnAfterWinSeconds: number;
    /** Weights for having 1, 2, 3… spawns at once; its length is the cap. */
    countWeights: number[];
    /** How long one roll of countWeights holds. */
    windowMinutes: number;
    /** At most one new spawn this often. */
    spawnGapSeconds: number;
    /** How long one spawn lasts. */
    lifetimeMinutes: { min: number; max: number };
    /**
     * The combat level that opens each enemy tier: the first is tier 1 (so 1),
     * the next tier 2, and so on. Enemies of a tier the player hasn't opened
     * never spawn for them.
     */
    tierUnlockLevels: number[];
    /**
     * How common enemies of tiers below the player's are, against their own
     * tier's (1): one tier below, two below… The last carries on for any
     * lower. Above 0, so old materials still turn up.
     */
    lowerTierWeights: number[];
    /**
     * How hard a quest pulls new spawns toward the enemies its kill
     * objectives still need, against `enemies` (1). They spawn anywhere,
     * whatever their habitat or tier, so a quest never needs water nearby.
     */
    questTargetWeight: number;
    /** Which enemies spawn anywhere, how often. Enemies with no `habitats` spawn only from here. */
    enemies: { enemyId: string; weight: number }[];
    /**
     * How hard each kind of place pulls new spawns toward the enemies living
     * there (their `habitats`). Each new spawn picks where it's from by
     * weight: `enemies` above has 1, and each kind of place nearby has its
     * `weight` when the player is on it, fading to nothing at
     * `influenceMetres`. A place within reach gets its spawns beside it;
     * farther, they land on the player's side facing it.
     */
    habitats: Record<GeoWorldHabitat, { influenceMetres: number; weight: number }>;
};

export type FarmingConfig = {
    /** The farm takes a turn on its own this often. */
    turnHours: number;
    /** Turns the farm takes without the player looking; past this it waits for them. */
    maxTurnsAway: number;
    /** A new farm owns a square this many tiles across, in the middle of the grid. */
    startSize: number;
    /**
     * The nth extra tile costs first + step × (n − 1) coins, and from the
     * `compostFrom`th bought on also `compost` of `itemId` (Compost Bins
     * make it).
     */
    unlockCost: { first: number; step: number; compost: number; compostFrom: number; itemId: string };
    /** Harvest or push: rot chance on each turn a ripe crop waits; the list's length caps the bonus. */
    rotChances: number[];
    /** Added to a mutation's chance on a tile for each cycle in a row its recipe has held there without sprouting. */
    mutationRamp: number;
    /**
     * Nuclear waste. Each turn a waste tile spreads to a tile beside it
     * with `spreadChance` (killing what grows there); empty tiles next to
     * waste get mutation chances × `mutationBoost`; and each waste tile has
     * `pestChance` of a `pest` crawling out.
     */
    waste: { spreadChance: number; mutationBoost: number; pestChance: number; pest: string };
    /**
     * The Mysterious Shrine. An offering worth `value` coins (NPC) grants a
     * blessing with chance value ÷ (value + `halfValue`); a failed roll is a
     * curse `curseShare` of the time. Picks by `weight`.
     */
    shrine: {
        halfValue: number;
        curseShare: number;
        blessings: { id: "growth" | "plenty" | "mutation" | "pests"; name: string; description: string; turns: number; weight: number; curse: boolean }[];
    };
    /**
     * Pests. None spawn before turn number `fromTurn`. Each turn, one
     * spawns with chance `chancePerCrop` × liked crops growing, at most
     * `maxChance`, while fewer than `max` are on the farm.
     */
    pests: { fromTurn: number; chancePerCrop: number; maxChance: number; max: number };
    /** Hand Pollinate multiplies a tile's mutation chances by this. */
    pollinateBoost: number;
    /** Farm events: from turn `fromTurn`, each turn telegraphs one for the next with this `chance`. */
    events: { fromTurn: number; chance: number };
    /**
     * The weekly Order Board: `perWeek` orders for plain crops, each worth
     * `value` coins of NPC sell value; completing pays that × `rewardMultiplier`,
     * and accepting costs `depositShare` of the reward.
     */
    orders: { perWeek: number; value: Range; rewardMultiplier: number; depositShare: number };
    /** Weekly contests: coins for 1st, 2nd, 3rd…, and `participation` for every other entrant. */
    contests: { prizes: number[]; participation: number };
    /**
     * The Pesthunter: a caged pest turned in pays its `bounty` in points,
     * spent here on `shop` items (`price` in points).
     */
    pesthunter: { shop: { itemId: string; price: number }[] };
    /**
     * Server-wide events, one picked each week by `weight` and announced on
     * Monday. It runs for the week's last `days` days (2: Saturday and Sunday,
     * UTC), and every farm's turns during it get it.
     */
    globalEvents: { eventId: string; days: number; weight: number }[];
    /** How often each weather is rolled for a turn. */
    weatherWeights: Record<GeoFarmWeather, number>;
};

export type FishingConfig = {
    /** Before gear and mayor perks, 0–1. */
    baseOdds: {
        /** Chance a catch is an eel. */
        eelChance: number;
        /** Chance a cast doesn't use up its bait. */
        baitSaveChance: number;
        /** Chance a catch is a sea creature to fight instead. */
        seaCreatureChance: number;
    };
    /** How often each rarity bites, when the water allows it. */
    rarityWeight: Record<Rarity, number>;
    /** Which rarities can bite in each water. */
    waterRarities: Record<GeoFishingTier, Rarity[]>;
    /** Quality thresholds × this: rarer fish need more Finesse. */
    rarityDifficulty: Record<Rarity, number>;
    /** Fishing Power a fish of this rarity shrugs off: only power above it reels faster and tires it quicker. */
    rarityPower: Record<Rarity, number>;
    /** Turns a clean fight should take. Past par, nothing earns Finesse and each turn costs 1. */
    parTurns: Record<Rarity, number>;
    /** NPC sell value of a regular (non-quality) fish, by its rarity. */
    sellValue: Record<Rarity, number>;
    tuning: {
        /** The sweet zone's bottom, as a share of the line's cap. */
        zoneLow: number;
        /** The sweet zone's top. */
        zoneHigh: number;
        /** Finesse needed per quality tier. */
        tierThresholds: Record<GeoQualityTier, number>;
        /** A fight this long is lost. */
        maxTurns: number;
    };
    /**
     * The enemies a sea creature can be in each water, picked by weight. An
     * empty list means no sea creatures bite there at all.
     */
    seaCreatures: Record<GeoFishingTier, { enemyId: string; weight: number }[]>;
};

export type WardrobeConfig = {
    /** Loadout slots every player starts with. */
    startingSlots: number;
    /** The most slots that can be bought up to. */
    maxSlots: number;
    /** Coins for the first slot bought past the start, then `step` more for each after. */
    slotCost: { first: number; step: number };
};

export type ElectionsConfig = {
    /** In office before any election has finished. */
    firstMayor: string;
    /** Mayors standing in each election. */
    candidates: number;
    /** An election ends at the first Monday 00:00 UTC at least this far away. */
    minHours: number;
};

export type EconomyConfig = {
    /** NPC sell value for items without their own sellValue. */
    placeholderSellValue: Record<Rarity, number>;
};

export type WeaponsConfig = {
    /** Weapon types, e.g. "dagger". Weapons and requiresWeapon use these. */
    types: string[];
    /** How weapons fight, e.g. "melee". */
    styles: string[];
    /** Off-hand types, e.g. "shield". Off-hand armor and requiresOffHand use these. */
    offHandTypes: string[];
    /**
     * What the player fights with when no weapon is equipped: its type and
     * style (for `requiresWeapon`) and its stats, e.g. +1 attack for fists.
     */
    unarmed: { type: string; style: string; modifiers: StatModifier[] };
};

export type PetsConfig = {
    /** Levels stop here. XP past it is kept but adds nothing. */
    maxLevel: number;
    /**
     * PLACEHOLDER curve: XP from level L to L + 1 is base × L × the rarity's
     * multiplier, so a rarer pet levels slower (and drops levels when Kat
     * raises it, keeping its XP).
     */
    xpCurve: { base: number; rarityMultiplier: Record<Rarity, number> };
    /** Share of another skill's XP the active pet gains (Hypixel: a third). */
    otherSkillShare: number;
    /** Extra pet XP from a skill, e.g. `{ fishing: 1.5 }`. Unlisted = 1. */
    skillMultiplier: Record<string, number>;
    /** Kat's price to raise a pet from each rarity, for pets without their own. */
    upgrades: Partial<Record<Rarity, PetUpgrade>>;
    /** Taken off Kat's coins and hours per pet level, e.g. 0.003 = 30% at level 100. */
    upgradeDiscountPerLevel: number;
    /** Coins to take a held item off a pet, by the held item's rarity. */
    heldItemRemovalCost: Record<Rarity, number>;
};

export type ChestTiersConfig = {
    /** Shown name and coins to open (0 = free), for each of the fixed tiers. */
    tiers: { id: GeoChestTier; name: string; cost: number }[];
};
