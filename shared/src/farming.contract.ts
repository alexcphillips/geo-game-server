import type { GeoHandCard } from "./run.contract";

/**
 * Farming: one grid per player that runs on a real clock. Every 12h the farm
 * takes a turn on its own: crops grow, weather lands, pests move, and the
 * farming hand is ready again: each card plays once a cycle, up to
 * GEO_HAND_SIZE plays in all. Planting, harvesting and clearing are free.
 * After a couple of turns without the player looking, the farm waits for
 * them. The server
 * runs every rule (catching up when the farm is next looked at); the app
 * shows what it says.
 *
 * The farm can be looked at (and planned on, with blueprints) anywhere, but
 * only worked at a farming place.
 */

/** The farm is a square this many tiles across; tiles are unlocked one at a time. */
export const GEO_FARM_SIZE = 9;

/** A farm turn's weather: a seeded roll per turn, the same whenever it's asked. */
export const GEO_FARM_WEATHERS = ["clear", "rain", "heatwave", "frost"] as const;
export type GeoFarmWeather = (typeof GEO_FARM_WEATHERS)[number];

/**
 * A tile's ground on a cycle, set by the sky and what's around it (nobody
 * waters): wet under rain or beside a Pond; dry in
 * a heatwave out in the open with no Well near; else normal. Crops on dry
 * ground don't grow that cycle. Mutation recipes can need either.
 */
export const GEO_FARM_GROUNDS = ["normal", "wet", "dry"] as const;
export type GeoFarmGround = (typeof GEO_FARM_GROUNDS)[number];

/** What a farming card aims at, so the app can preview it on the grid. `ring` is the 8 tiles around the one aimed at; `cross` the 4 beside it, not the middle. */
export type GeoFarmCardShape = "tile" | "row" | "square3" | "ring" | "cross" | "none";

/** A crop growing (or rotting) on a tile. */
export type GeoFarmCrop = {
    cropId: string;
    /** 0 = just planted; ripe at `stages`. */
    stage: number;
    stages: number;
    ripe: boolean;
    /** Turns it has sat ripe: each adds yield and risks rot. */
    ripeTurns: number;
    /** Chance it rots on the next turn, 0–1. 0 while held or growing. */
    rotChance: number;
    /** Held: the next turn neither rots nor improves it. */
    held: boolean;
    rotten: boolean;
};

export type GeoFarmTile = {
    /** 0 … GEO_FARM_SIZE² − 1, row by row. */
    index: number;
    x: number;
    y: number;
    owned: boolean;
    /** Locked, but next to an owned tile: can be bought now. */
    unlockable: boolean;
    crop: GeoFarmCrop | null;
    /** Its ground on the coming cycle, by the forecast. Dry: a growing crop won't grow. */
    ground: GeoFarmGround;
    /** The planned crop: a faded ghost, nothing more. */
    blueprint: string | null;
    /** A Snap Trap: catches a pest that moves onto it on the next turn. */
    trap: boolean;
    /** Hand Pollinated: better mutation odds here on the next turn. */
    pollinated: boolean;
    /** A structure standing here instead of a crop (a multi-tile one stands on its middle tile). */
    structure: GeoFarmStructure | null;
    /** Covered by the multi-tile structure standing on the tile with this index. */
    partOf: number | null;
    /** Mutation recipes that have held on this empty tile for `cycles` cycles in a row: each one raises its chance here. */
    setups: { mutationId: string; cycles: number }[];
    /** Under a Greenhouse roof placed from tile `anchor`: crops grow here, sheltered. Demolishing works from any tile under it. */
    roof: { anchor: number; structureId: string } | null;
    /** Nuclear waste: nothing grows here, it spreads, and it stirs up mutations and glowing pests nearby. */
    waste: boolean;
};

/** What a structure does; the rules are the server's. */
export type GeoStructureKind =
    | "jukebox"
    | "cage"
    | "beehive"
    | "compost"
    | "pond"
    | "greenhouse"
    | "reactor"
    | "portal"
    | "shrine"
    | "well";

/** A structure on a tile, with what it holds. */
export type GeoFarmStructure = {
    structureId: string;
    /** Jukebox: the pest whose tune is playing, or null when it's quiet. */
    tune: string | null;
    /** Pest Cage: the pest kept inside, or null when empty. */
    caged: string | null;
    /** Compost Bin: harvests and clears toward its next Compost. */
    compost: number;
    /** Portal: torn open, so elite pests come through on the next turn. */
    open: boolean;
};

/** A farm event, as the app shows it. */
export type GeoFarmEventView = {
    id: string;
    name: string;
    icon: string;
    description: string;
    /** Travelling Merchant: what's for sale this turn. */
    offers: { itemId: string; price: number; bought: boolean }[];
};

/** One order on the board: deliver `quantity` of `itemId` by the week's end. */
export type GeoFarmOrder = {
    id: string;
    itemId: string;
    quantity: number;
    delivered: number;
    /** Coins paid on completion, on top of the deposit back. */
    reward: number;
    /** Coins paid to accept, lost if the week ends first. */
    deposit: number;
    status: "offered" | "accepted" | "done";
};

export type GeoOrderBoard = {
    orders: GeoFarmOrder[];
    /** When this week's orders end (ISO); unfinished accepted ones lose their deposit. */
    endsAt: string;
};

export type GeoGlobalFarmEvent = {
    event: GeoFarmEventView;
    startsAt: string;
    endsAt: string;
    /** On now: turns played now get it. */
    active: boolean;
};

/** The weekly farm contests. `harvest` and `crop` add up NPC value; `mutation` is the best single harvest. */
export const GEO_FARM_CONTESTS = ["harvest", "mutation", "crop"] as const;
export type GeoFarmContestId = (typeof GEO_FARM_CONTESTS)[number];

export type GeoFarmContests = {
    /** When this week's contests close and pay out (ISO). */
    endsAt: string;
    /** The crop this week's crop contest is for. */
    cropId: string;
    /** Coins for 1st, 2nd, 3rd; `participation` for every other entrant. */
    prizes: number[];
    participation: number;
    standings: {
        contest: GeoFarmContestId;
        /** The player's score, and rank among `entrants` (null before they enter). */
        score: number;
        rank: number | null;
        entrants: number;
        /** The leaders, best first. */
        top: { name: string; score: number }[];
    }[];
};

/** A kind of structure, as the app needs it to draw and explain one. */
export type GeoStructureView = {
    id: string;
    kind: GeoStructureKind;
    name: string;
    icon: string;
    description: string;
    /** Extra lines for the Build list. */
    stats: { label: string; value: string }[];
    /** Taken from the inventory when it's built; never refunded. */
    cost: GeoFarmGain[];
    /** Tiles it covers, centred on the tile it's placed from (an even side reaches one further right or down). */
    size: { width: number; height: number };
    /** The farming level needed to place it; 0 = none. */
    requiredLevel: number;
    /** Compost Bin: harvests and clears per Compost it makes; null for anything else. */
    capacity: number | null;
};

/**
 * What a pest will do on the next turn, shown before it happens. `tile`
 * is where it acts; a pest moves there first if it isn't there already.
 * Telegraphed moves are promises: clearing the crop first makes them miss.
 */
export type GeoFarmPestIntent =
    /** Moves onto `tile` if it isn't there, and eats the crop: it's gone. */
    | { kind: "eat"; tile: number }
    /** Moves onto `tile` (its own tile: stays put). */
    | { kind: "move"; tile: number }
    /** The crop on its tile doesn't grow. */
    | { kind: "sap"; tile: number }
    /** A new pest of its kind appears on `tile`; the crop it's on doesn't grow. */
    | { kind: "breed"; tile: number };

/** A pest on the farm: a piece on the grid, cleared with Swat or pest cards. */
export type GeoFarmPest = {
    /** Unique within the farm, for keys. */
    id: number;
    pestId: string;
    tile: number;
    intent: GeoFarmPestIntent;
    /** The intent in words: "Eats the Carrot at (4, 5)". */
    intentText: string;
    /** Hits left: most pests go down in one, elite ones take more. */
    hp: number;
};

/** A kind of pest, as the app needs it to draw and explain one. */
export type GeoPestView = {
    id: string;
    name: string;
    icon: string;
    description: string;
    /** Crop ids it's drawn to: growing them is what brings it. */
    likes: string[];
    /** Pesthunter points for turning one in from a Pest Cage. */
    bounty: number;
};

/** The Pesthunter: caged pests turned in for points, spent in a small shop. */
export type GeoPesthunter = {
    points: number;
    /** Each buy is one of `itemId` for `price` points; `offer` in a buy is the index here. */
    shop: { itemId: string; price: number }[];
};


/**
 * A crop as the app needs it to plant, plan and draw. Mutations are listed
 * only once found (turned in at the Research Lab) or growing on the farm,
 * so the list never gives a secret away.
 */
export type GeoCropView = {
    id: string;
    name: string;
    icon: string;
    /** Null for a mutation: it can't be planted, only sprouted. */
    seedItemId: string | null;
    produceItemId: string;
    stages: number;
    mutation: boolean;
};

/** A mutation in the Research Lab's journal: found, so its recipe shows. */
export type GeoLabEntry = {
    mutationId: string;
    name: string;
    icon: string;
    description: string;
    produceItemId: string;
    /** The recipe in words: "2 ripe Wheat next to an empty tile, on a Heatwave". */
    recipe: string;
};

/**
 * The Research Lab: mutations are found by experimenting, and turning the
 * first of each in records its recipe here and pays a one-off reward.
 */
export type GeoResearchLab = {
    found: GeoLabEntry[];
    /** How many mutations there are in all, found or not. */
    total: number;
    /** Mutations not yet found whose crop the player holds: each can be turned in now. */
    ready: { mutationId: string; itemId: string; coins: number; xp: number }[];
};

/** `POST /geo/farm/lab`. */
export type GeoResearchRequest = { mutationId: string };

/** One farming card in hand, with what it aims at and whether it has played this cycle. */
export type GeoFarmHandCard = GeoHandCard & {
    shape: GeoFarmCardShape;
    /** Played this cycle: it's ready again next cycle, even if moved out of the hand and back. */
    played: boolean;
};

/** Items a farm action put in the inventory. */
export type GeoFarmGain = { itemId: string; quantity: number };

export type GeoFarmView = {
    size: number;
    tiles: GeoFarmTile[];
    /** Turns the farm has taken so far. */
    turn: number;
    /** Card plays left this cycle, out of GEO_HAND_SIZE. Swapping cards in doesn't add any. */
    playsLeft: number;
    /** The player's farming level, for what it unlocks (structures' `requiredLevel`). */
    farmingLevel: number;
    /** Farming Fortune from gear, talismans and global perks: each 100 adds a harvest's crops again (1000 = ×11). */
    fortune: number;
    /** When the farm takes its next turn. */
    nextTurnAt: string;
    /** Real hours between turns, for drawing how far the current one has come. */
    turnHours: number;
    /** Turns the farm takes while the player is away; past this it waits for them. */
    maxTurnsAway: number;
    /** Weather for the coming turns, soonest first. One unless the sky has been read. */
    forecast: GeoFarmWeather[];
    /** Farm events: the one coming on the next turn (telegraphed), and the one on now. */
    events: { next: GeoFarmEventView | null; active: GeoFarmEventView | null };
    /** This week's Order Board. */
    orders: GeoOrderBoard;
    /** This week's server-wide event, if any: everyone's turns during it get it. */
    global: GeoGlobalFarmEvent | null;
    /** This week's contests, with the player's standing. */
    contests: GeoFarmContests;
    /** Shrine blessings (and curses) on the farm, each with the turns it has left. */
    blessings: { id: string; name: string; description: string; curse: boolean; turnsLeft: number }[];
    /** What the next tile costs: coins, and Compost (`compostItemId`) once a few are bought. Null when every tile is owned. */
    unlockCost: { coins: number; compost: number } | null;
    /** The item tile unlocks take as Compost. */
    compostItemId: string;
    hand: GeoFarmHandCard[];
    crops: GeoCropView[];
    /** Every pest on the farm, each with its next move. */
    pests: GeoFarmPest[];
    /** Every kind of pest there is. */
    pestTypes: GeoPestView[];
    lab: GeoResearchLab;
    pesthunter: GeoPesthunter;
    /** The structures on the farm, and the ones the player can build: what the app draws and lists. */
    structureTypes: GeoStructureView[];
    /** What can be built now (its farming level reached), by id, cheapest level first. Costs come from the inventory. */
    buildList: string[];
    /** What the last action did, in order. */
    log: string[];
    /** What the last action put in the inventory. */
    gained: GeoFarmGain[];
    /** Farming XP the last action gave. */
    xpGained: number;
};

/**
 * `POST /geo/farm/actions`. Work needs the player at a farming place;
 * `blueprint` (planning) and the Pesthunter (`turn-in`, `pesthunter-buy`)
 * work anywhere.
 */
export type GeoFarmAction =
    /** Free: takes one of these seeds from the inventory. */
    | { type: "plant"; tile: number; itemId: string }
    /** Free: seeds into every empty owned tile. A planned tile takes its planned crop's seed while those last; the rest take `itemId` (null = planned tiles only). */
    | { type: "plant-all"; itemId: string | null }
    /** Free: a ripe crop into the inventory. */
    | { type: "harvest"; tile: number }
    /** Free: every ripe crop on the farm into the inventory. */
    | { type: "harvest-all" }
    /** Free: pulls up whatever is there, rotten or not, for nothing. */
    | { type: "clear"; tile: number }
    /** Its cost from the inventory: a structure off the Build list, centred on the tile; every tile it covers must be owned and clear (a Greenhouse can go over crops). */
    | { type: "place"; tile: number; structureId: string }
    /** Free: the structure on or over the tile is torn down, whole, with nothing back (a Pest Cage must be empty). */
    | { type: "demolish"; tile: number }
    /** Free: the Jukebox plays this pest's tune, or nothing. */
    | { type: "tune"; tile: number; pestId: string | null }
    /** Free: one pest on `tile` into an empty Pest Cage on or next to it, alive. */
    | { type: "cage"; tile: number }
    /** Free: the Pest Cage's pest is let out and cleared, rolling its drops. */
    | { type: "release"; tile: number }
    /** Free: the Pest Cage's pest goes to the Pesthunter for its bounty in points (no drops). */
    | { type: "turn-in"; tile: number }
    /** Pesthunter points: one of the Pesthunter's shop items, by index. */
    | { type: "pesthunter-buy"; offer: number }
    /** Free: items onto the Mysterious Shrine. Their NPC value buys a roll for a blessing; it may answer with a curse. */
    | { type: "offer"; tile: number; itemId: string; quantity: number }
    /** Coins: buy the Travelling Merchant's offer at this index. */
    | { type: "buy"; offer: number }
    /** Coins (the deposit): take an order on. */
    | { type: "accept-order"; orderId: string }
    /** Hands in as much of the order's crop as the player holds; pays out when it's complete. */
    | { type: "deliver-order"; orderId: string }
    /** A farming card at a tile (any tile for shape "none"). */
    | { type: "play"; inventoryId: string; tile: number }
    /** Coins: a locked tile next to the farm. */
    | { type: "unlock"; tile: number }
    /** The plan: a ghost crop on a tile, or null to clear it. */
    | { type: "blueprint"; tile: number; cropId: string | null };

export const GEO_FARM_ACTION_TYPES = [
    "plant",
    "plant-all",
    "harvest",
    "harvest-all",
    "clear",
    "place",
    "demolish",
    "tune",
    "cage",
    "release",
    "turn-in",
    "pesthunter-buy",
    "offer",
    "buy",
    "accept-order",
    "deliver-order",
    "play",
    "unlock",
    "blueprint",
] as const satisfies readonly GeoFarmAction["type"][];
