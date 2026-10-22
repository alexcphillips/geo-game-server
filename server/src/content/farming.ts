import type { GeoFarmCardShape, GeoFarmGround, GeoFarmWeather } from "@geo/shared";

/**
 * Farming's types and ids. The crops are `data/crops/`, the mutations
 * `data/mutations/`, the pests `data/pests/`, the structures `data/structures/`,
 * the farm events `data/farm-events/`, the cards
 * `data/cards/farming/`, and every tuning number `data/config/farming.ts`.
 *
 * Like fishing, farming cards are hard-coded rules (`farming/farm.ts`) keyed
 * by card id until the farm has engine effects of its own, so every farming
 * card file must be one of FARMING_CARDS (checked at boot). The shape lives
 * here, beside the rules, so the app can preview a card.
 */

export type CropDef = {
    id: string;
    name: string;
    icon: string;
    seed: string;
    produce: string;
    stages: number;
    yield: { min: number; max: number };
    seedsBack: { min: number; max: number };
    xp: number;
};

/** What has to be true around an empty tile each turn for a mutation to roll there. */
export type MutationRecipe = {
    parents: { cropId: string; count: number }[];
    weather?: GeoFarmWeather;
    event?: string;
    pest?: string;
    structure?: string;
    blessing?: string;
    ground?: GeoFarmGround;
};

/** A fantasy crop that only sprouts from a recipe. Grows and harvests like a crop, with no seeds. */
export type MutationDef = {
    id: string;
    name: string;
    icon: string;
    description: string;
    produce: string;
    stages: number;
    yield: { min: number; max: number };
    xp: number;
    recipe: MutationRecipe;
    chance: number;
    research: { coins: number; xp: number };
};

/** Anything that grows on a tile: a crop, or a mutation (no seed). */
export type GrowsDef = CropDef | MutationDef;

/** What a farm event does; the rules are in `farming/farm.ts`. */
export type FarmEventEffect =
    /** On its turn: `count` extra pests arrive, past the usual cap. */
    | { kind: "pest-swarm"; count: number }
    /** On its turn: recipes can need it, and pests are `pestBoost` × likelier to come. */
    | { kind: "blood-moon"; pestBoost: number }
    /** For the turn after it comes: every harvest +`bonus` yield. */
    | { kind: "bumper-harvest"; bonus: number }
    /** For the turn after it comes: `count` of `stock` are for sale. */
    | { kind: "merchant"; count: number; stock: { itemId: string; price: number }[] }
    /** On its turn: mutation chances × `mutationBoost`, and each empty tile has `dropChance` of `itemId` falling on it. */
    | { kind: "meteor-shower"; mutationBoost: number; dropChance: number; itemId: string };

export type FarmEventDef = {
    id: string;
    name: string;
    icon: string;
    description: string;
    /** How often it's the one rolled on a farm; 0 for a global-only event. */
    weight: number;
    effect: FarmEventEffect;
};

/** What a structure does on the farm; the rules are in `farming/farm.ts`. */
export type StructureEffect =
    /** Its tune makes that pest `boost` times likelier to be the one that spawns. */
    | { kind: "jukebox"; boost: number }
    /** Keeps one pest alive: it counts as that pest nearby for mutation recipes. */
    | { kind: "cage" }
    /** Mutation chances × `boost` on the tiles around; each turn, `swarmChance` the crops around don't grow. */
    | { kind: "beehive"; boost: number; swarmChance: number }
    /** Every `capacity` harvests and clears on the farm make one `itemId` (Compost). */
    | { kind: "compost"; capacity: number; itemId: string }
    /** The 4 tiles beside it are wet ground, and its frog eats 1 pest on or around it each turn. */
    | { kind: "pond" }
    /** A roof over its whole footprint: crops grow under it with no weather, no pests arriving and no mutations sprouting. */
    | { kind: "greenhouse" }
    /** Crops within `radius` grow `growth` extra stages a turn; each turn, `wasteChance` waste lands within `radius`. */
    | { kind: "reactor"; radius: number; growth: number; wasteChance: number }
    /** Tear the Veil opens it: on the next turn, `wave` of `pests` come through, then it shuts. */
    | { kind: "portal"; wave: number; pests: string[] }
    /** Takes offerings: their NPC value buys a roll for a blessing (`config/farming.ts` `shrine`). */
    | { kind: "shrine" }
    /** Tiles within `radius` never go dry, even in a heatwave. */
    | { kind: "well"; radius: number };

export type StructureDef = {
    id: string;
    name: string;
    icon: string;
    description: string;
    /** Extra lines in the Build list. */
    stats: { label: string; value: string }[];
    /** Taken from the inventory when it's built; never refunded. */
    cost: { itemId: string; quantity: number }[];
    /** Tiles it covers, centred on the tile it's placed from; 1×1 unless the file says. */
    size: { width: number; height: number };
    /** The farming level needed to place it; 0 = none. */
    requiredLevel: number;
    effect: StructureEffect;
};


/** How a pest behaves on the grid; the rules are in `farming/farm.ts`. */
export type PestBehaviour =
    /** Eats a crop within `reach` tiles (on its own tile first), moving onto it. */
    | { kind: "eat"; reach: number }
    /** Saps the crop it's on (it doesn't grow); with none, moves to one next door. */
    | { kind: "sap" }
    /** Saps the crop it's on; every `every` turns, breeds onto a next-door crop. */
    | { kind: "breed"; every: number };

export type PestDrop = { itemId: string; chance: number; quantity: { min: number; max: number } };

export type PestDef = {
    id: string;
    name: string;
    icon: string;
    description: string;
    likes: string[];
    behaviour: PestBehaviour;
    weight: number;
    /** Hits it takes to clear; 1 unless elite. */
    hp: number;
    drops: PestDrop[];
    xp: number;
    /** Pesthunter points for turning it in from a Pest Cage. */
    bounty: number;
};

/** The farming cards whose rules exist in `farming/farm.ts`, with the shape the app previews. */
export const FARMING_CARDS = {
    /** Hits every pest on a tile once. */
    "farm.swat": { shape: "tile" },
    /** Harvest one ripe crop with +1 yield. */
    "farm.careful-pick": { shape: "tile" },
    /** Harvest every ripe crop in a 3×3, each giving its seeds back twice. */
    "farm.scythe-sweep": { shape: "square3" },
    /** A growing crop moves one stage now. */
    "farm.ripen": { shape: "tile" },
    /** A ripe crop neither rots nor improves on the next turn. */
    "farm.hold": { shape: "tile" },
    /** The forecast shows 3 turns until the next one. */
    "farm.read-sky": { shape: "none" },
    /** Clears every pest in a 3×3; ripe crops in it lose their waiting bonus. */
    "farm.smoke": { shape: "square3" },
    /** Pulls every pest in the 8 tiles around onto the middle one. */
    "farm.bait-ring": { shape: "ring" },
    /** Arms a tile: a pest moving onto it on the next turn is caught. */
    "farm.snap-trap": { shape: "tile" },
    /** Scrubs nuclear waste off one tile. */
    "farm.hazmat-scrub": { shape: "tile" },
    /** Waste on the 4 tiles beside the aimed one (not the middle), killing what grows there. */
    "farm.controlled-leak": { shape: "cross" },
    /** Tears a Portal open: elite pests come through on the next turn. */
    "farm.tear-the-veil": { shape: "tile" },
    /** An empty tile rolls the mutations whose recipes hold there now, at half chance. */
    "farm.coax": { shape: "tile" },
    /** The next turn comes under a Blood Moon. */
    "farm.moon-rite": { shape: "none" },
    /** The next 3 pests cleared roll their drops twice. */
    "farm.exterminators-oath": { shape: "none" },
    /** Every waste tile: 30% it turns into a random mutation, else a Glow Beetle crawls out. */
    "farm.chain-reaction": { shape: "none" },
    /** An empty tile's mutation odds go up on the next turn; ripe crops around lose their wait. */
    "farm.hand-pollinate": { shape: "tile" },
} as const satisfies Record<string, { shape: GeoFarmCardShape }>;

export type FarmingCardId = keyof typeof FARMING_CARDS;
export const FARMING_CARD_IDS = Object.keys(FARMING_CARDS) as FarmingCardId[];

export const isFarmingCardId = (id: string): id is FarmingCardId => Object.hasOwn(FARMING_CARDS, id);
