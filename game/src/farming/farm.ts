import type { GeoFarmAction, GeoFarmGain, GeoFarmGround, GeoFarmOrder, GeoFarmPestIntent, GeoFarmWeather } from "@geo/shared";
import { GEO_FARM_SIZE, GEO_FARM_WEATHERS, GEO_HAND_SIZE } from "@geo/shared";
import {
    isFarmingCardId,
    type CropDef,
    type FarmEventDef,
    type FarmingCardId,
    type GrowsDef,
    type MutationDef,
    type PestDef,
    type StructureDef,
} from "../content/farming";
import type { FarmingConfig } from "../content/models";
import { createRng, type Rng } from "../engine/rng";

/**
 * The farming rules: pure and seeded, like fishing and combat. Each step
 * takes the stored farm and returns the next, plus what the repository must
 * save alongside it in the same transaction (a seed out of the bag, a card's
 * charge, the harvest, coins for a tile).
 *
 * The farm runs on a real clock: every `turnHours` it takes a turn on its
 * own, with the weather of the hours just past (a seeded roll per period,
 * via a `WeatherLookup`). Nothing runs in the background: when the
 * farm is next looked at, `catchUp` plays the turns that came due since. It
 * plays at most `maxTurnsAway` of them; past that the farm waits for the
 * player, so being away never loses more than that, and can't be saved up.
 *
 * Pests are pieces on the grid. Each carries the move it will make on the
 * next turn (planned when it arrives, and again after every turn), so the
 * player sees it coming. A turn runs: pests act, weather and growth,
 * mutations may sprout, new pests arrive, every pest plans its next move.
 *
 * Nobody waters. Each tile's ground (`groundAt`) comes from the sky and
 * what's around it: wet under rain or beside a Pond; dry in an open heatwave unless a Well is near. Crops on dry ground
 * don't grow that turn, and recipes can need either.
 *
 * Structures stand on tiles instead of crops and change the farm around
 * them. A structure can cover several tiles (`size`, centred on the tile it's
 * placed from): it stands on that tile, and the rest are `partOf` it. A
 * Greenhouse is a roof instead: crops grow under it (`roof` on each tile),
 * sheltered from the sky. Otherwise: a Pond's frog eats a pest before pests act, Beehives may swarm,
 * Compost Bins turn harvests and clears into Compost, Beehives and caged pests help
 * mutations, a Jukebox's tune picks which pest comes.
 *
 * Farm events are telegraphed a turn ahead (`nextEvent`). Some act on
 * their turn (a pest swarm, a blood moon); some last the
 * turn after it (`activeEvent`: a bumper harvest, a travelling merchant).
 * The weekly Order Board (`orders`) is refreshed by `refreshOrders`.
 *
 * The gambles: a Nuclear Reactor speeds crops near it but leaks waste that
 * spreads and kills, while stirring up mutations and glowing pests; a Portal
 * brings elite pests (several hits each) with rich drops; the Mysterious
 * Shrine turns offerings into a roll for a blessing, or a curse.
 *
 * Mutations sprout on empty tiles whose surroundings meet a secret recipe
 * (ripe parents around, maybe a weather, a pest, a structure). They grow and
 * harvest like crops, without seeds.
 *
 * PLACEHOLDER: card rules are a switch on card id, as in fishing, until the
 * farm has engine effects (shapes, timings, keywords) of its own.
 */

export class FarmRuleError extends Error {}

export type FarmCrop = {
    cropId: string;
    stage: number;
    ripeTurns: number;
    held: boolean;
    rotten: boolean;
};

export type FarmTile = {
    owned: boolean;
    crop: FarmCrop | null;
    blueprint: string | null;
    /** Snap Trap: catches a pest moving onto it on the next turn. */
    trap: boolean;
    /** Hand Pollinate: mutation odds here are boosted on the next turn. */
    pollinated: boolean;
    /** A structure standing here instead of a crop (on a multi-tile one's middle tile). */
    structure: FarmStructure | null;
    /** Covered by the multi-tile structure standing on this tile index; nothing else goes here. */
    partOf: number | null;
    /** Under a Greenhouse roof (placed from `anchor`): crops grow here, with no weather, no pests arriving and no mutations. */
    roof: FarmRoof | null;
    /** Nuclear waste: nothing grows or is built here until it's scrubbed. */
    waste: boolean;
};

export type FarmStructure = {
    structureId: string;
    /** Jukebox: the pest whose tune plays. */
    tune: string | null;
    /** Pest Cage: the pest kept inside. */
    caged: string | null;
    /** Compost Bin: harvests and clears in it so far, toward its next Compost. */
    compost: number;
    /** Portal: torn open for the next turn. */
    open: boolean;
};

export type FarmRoof = { anchor: number; structureId: string };

/** A mutation recipe that has held on an empty tile for `cycles` cycles in a row. */
export type FarmSetup = { tile: number; mutationId: string; cycles: number };

export type FarmPest = {
    id: number;
    pestId: string;
    tile: number;
    /** Turns it has lived through. */
    age: number;
    /** What it does on the next turn. */
    intent: GeoFarmPestIntent;
    /** Hits left; missing on pests saved before elites (1). */
    hp?: number;
};

/** Everything a farm keeps, in `geo.farms.state`. */
export type FarmState = {
    version: typeof FARM_VERSION;
    /** Rolls for harvests and rot; replaced after every step so it never has to fast-forward. */
    seed: number;
    /** Fixed for the farm's life: the weather of turn n is the same whenever it's asked. */
    weatherSeed: number;
    /** GEO_FARM_SIZE², row by row. */
    tiles: FarmTile[];
    /** Turns taken so far. */
    turn: number;
    /**
     * Farming cards played this cycle, by inventory id. Each card plays once
     * a cycle, and a cycle allows GEO_HAND_SIZE plays in all, so moving a card
     * out of the hand and back, or swapping others in, buys nothing.
     */
    played: string[];
    /**
     * Mutation setups that held last cycle without sprouting: each cycle in a
     * row adds `mutationRamp` to that recipe's chance on that tile, so a
     * setup kept together pays off within a few cycles. A cycle it doesn't
     * hold (or it sprouts) drops it.
     */
    setups: FarmSetup[];
    /** When the turn now coming started counting (ISO); it comes `turnHours` after, with that period's weather. */
    accruedAt: string;
    /** Read the Sky: the long forecast shows until the next turn. */
    skyRead: boolean;
    /** Tiles bought so far, for the next one's price. */
    unlocked: number;
    pests: FarmPest[];
    /** The next pest's id. */
    nextPestId: number;
    /** Mutations turned in at the Research Lab, first found first. */
    lab: string[];
    /** The farm event telegraphed for the next turn. */
    nextEvent: string | null;
    /** The event on for this turn (after the turn it came on), with a merchant's offers. */
    activeEvent: { eventId: string; offers: { itemId: string; price: number; bought: boolean }[] } | null;
    /** This week's Order Board; `week` counts weeks since the epoch's first Monday. */
    orders: { week: number; list: GeoFarmOrder[] } | null;
    /** Shrine blessings and curses on the farm, with the turns each has left. */
    blessings: { id: BlessingId; turnsLeft: number }[];
    /** Exterminator's Oath: how many more cleared pests roll their drops twice. */
    oath: number;
    /** Pesthunter points from caged pests turned in, not yet spent. */
    pesthunterPoints: number;
};

export type BlessingId = FarmingConfig["shrine"]["blessings"][number]["id"];

/** The farm state's version. Older saves aren't upgraded: farming is in testing, and `wipe:geo` resets them. */
export const FARM_VERSION = 17;

/** A farm as `geo.farms.state` holds it. */
export type StoredFarm = { version: number };

/** The stored farm, checked to be this version's. */
export function readFarm(stored: StoredFarm): FarmState {
    if (stored.version !== FARM_VERSION) throw new Error(`This farm was saved at v${stored.version}; the server reads v${FARM_VERSION}. Run npm run wipe:geo`);
    return stored as FarmState;
}

export type FarmHandCard = { inventoryId: string; itemId: string; cardId: string; chargesLeft: number };

/** What a step needs besides the farm, loaded by the repository. */
export type FarmContext = {
    crops: Record<string, CropDef>;
    mutations: Record<string, MutationDef>;
    pests: Record<string, PestDef>;
    structures: Record<string, StructureDef>;
    events: Record<string, FarmEventDef>;
    /** The server-wide event on now, if any (`activeGlobalEvent`). */
    globalEvent?: FarmEventDef;
    /** What an NPC pays for an item, for Shrine offerings. */
    sellValue: (itemId: string) => number;
    /** An item's name, for messages. */
    itemName: (itemId: string) => string;
    config: FarmingConfig;
    now: Date;
    hand: FarmHandCard[];
    /** How many of each item the player holds (seeds are planted and structures placed from these). */
    held: Record<string, number>;
    /** The player's farming level, for what it unlocks. */
    farmingLevel: number;
    /** Farming Fortune from gear, talismans and global perks: more crops per harvest (`withFortune`). 0 when absent. */
    fortune?: number;
    /** Multiplies the chance a pest arrives, from global perks and gear. 1 when absent. */
    pestChance?: number;
    /** Multiplies every mutation's chance to sprout, from global perks and gear. 1 when absent. */
    mutationChance?: number;
    /** The farm's weather by period; seeded rolls when absent. */
    weather?: WeatherLookup;
};

export type FarmStepResult = {
    state: FarmState;
    log: string[];
    gains: GeoFarmGain[];
    xp: number;
    /** One charge spent from this card. */
    cardPlayed: { inventoryId: string; chargesLeft: number } | null;
    /** Coins the step costs. */
    coins: number;
    /** Items the step takes from the inventory (a seed planted, a structure placed, an order delivered). */
    itemsUsed: GeoFarmGain[];
    /** Coins the step pays out (an order completed). */
    coinsGained: number;
    /** Each harvest's crop and haul, for the weekly contests. */
    harvested: { cropId: string; itemId: string; quantity: number; mutation: boolean }[];
};

/** Farming card plays left this cycle. */
export const playsLeft = (state: FarmState) => Math.max(0, GEO_HAND_SIZE - state.played.length);

const N = GEO_FARM_SIZE;
const HOUR_MS = 3_600_000;

export const tileXY = (index: number) => ({ x: index % N, y: Math.floor(index / N) });
const indexOf = (x: number, y: number) => y * N + x;
const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
const tileName = (index: number) => {
    const { x, y } = tileXY(index);
    return `(${x + 1}, ${y + 1})`;
};

/** Coax rolls a mutation at this share of its usual chance. */
const COAX_SHARE = 0.5;
/** Chain Reaction: each waste tile's chance of turning into a mutation. */
const CHAIN_REACTION_CHANCE = 0.3;

const newSeed = (rng: Rng) => Math.floor(rng.next() * 4_294_967_296) >>> 0;

/**
 * A new farm: a startSize square in the middle, everything
 * else locked. Its clock starts now.
 */
export function newFarm(config: FarmingConfig, seed: number, weatherSeed: number, now: Date): FarmState {
    const low = (N - config.startSize) / 2;
    const high = low + config.startSize;
    const tiles = Array.from({ length: N * N }, (_, index): FarmTile => {
        const { x, y } = tileXY(index);
        return {
            owned: x >= low && x < high && y >= low && y < high,
            crop: null,
            partOf: null,
            roof: null,
            blueprint: null,
            trap: false,
            pollinated: false,
            structure: null,
            waste: false,
        };
    });
    return {
        version: FARM_VERSION,
        seed,
        weatherSeed,
        tiles,
        turn: 0,
        played: [],
        setups: [],
        accruedAt: now.toISOString(),
        skyRead: false,
        unlocked: 0,
        pests: [],
        nextPestId: 1,
        lab: [],
        nextEvent: null,
        activeEvent: null,
        orders: null,
        blessings: [],
        oath: 0,
        pesthunterPoints: 0,
    };
}

/** When the farm takes its next turn. */
export function nextTurnAt(state: FarmState, config: FarmingConfig): Date {
    return new Date(new Date(state.accruedAt).getTime() + config.turnHours * HOUR_MS);
}

/** What the turns played on a look add up to; `turns` is 0 when none were due. */
export type FarmCatchUp = Pick<FarmStepResult, "state" | "log" | "gains" | "xp" | "harvested"> & { turns: number };

/**
 * Plays the turns that came due since the farm was last looked at, each
 * with the weather of the period it came over and the server-wide event on
 * then. At most `maxTurnsAway`: past that the farm waited, and its clock
 * starts again from `now`. `ctx.now` is ignored; each turn has its own time.
 */
export function catchUp(prev: FarmState, ctx: FarmContext): FarmCatchUp {
    const { config } = ctx;
    const period = config.turnHours * HOUR_MS;
    const since = new Date(prev.accruedAt).getTime();
    const due = Math.floor(Math.max(0, ctx.now.getTime() - since) / period);
    const turns = Math.min(due, config.maxTurnsAway);
    const lookup = ctx.weather ?? seededLookup(prev.weatherSeed, config);
    const total: FarmCatchUp = { state: prev, log: [], gains: [], xp: 0, harvested: [], turns };
    if (due === 0) return total;

    for (let i = 0; i < turns; i++) {
        const at = new Date(since + (i + 1) * period);
        const step = tickFarm(total.state, { ...ctx, now: at, globalEvent: activeGlobalEvent(at, config, ctx.events) }, lookup(since + i * period));
        total.state = step.state;
        total.log.push(...step.log);
        for (const { itemId, quantity } of step.gains) {
            const existing = total.gains.find((entry) => entry.itemId === itemId);
            if (existing) existing.quantity += quantity;
            else total.gains.push({ itemId, quantity });
        }
        total.xp += step.xp;
        total.harvested.push(...step.harvested);
    }
    const waited = due > turns;
    total.state = { ...total.state, accruedAt: new Date(waited ? ctx.now.getTime() : since + due * period).toISOString() };
    total.log.unshift(`The farm ran ${turns} cycle${turns === 1 ? "" : "s"}${waited ? ", then waited for you" : ""}.`);
    return total;
}

/** One turn of the farm's clock, with this weather. */
export function tickFarm(state: FarmState, ctx: FarmContext, weather: GeoFarmWeather = nextWeather(state, ctx)): FarmStepResult {
    return stepFarm(state, { type: "tick", weather }, ctx);
}

/** The weather the farm's next turn will have. */
const nextWeather = (state: FarmState, ctx: FarmContext) =>
    (ctx.weather ?? seededLookup(state.weatherSeed, ctx.config))(new Date(state.accruedAt).getTime());

/** A seeded weather roll for `key`: the placeholder when there's no real weather. */
function rollWeather(weatherSeed: number, config: FarmingConfig, key: number): GeoFarmWeather {
    const roll = createRng((weatherSeed ^ Math.imul(key, 0x9e3779b1)) >>> 0).next();
    const weights = GEO_FARM_WEATHERS.map((weather) => config.weatherWeights[weather]);
    let pick = roll * weights.reduce((sum, weight) => sum + weight, 0);
    for (const [i, weather] of GEO_FARM_WEATHERS.entries()) {
        pick -= weights[i]!;
        if (pick < 0) return weather;
    }
    return "clear";
}

/** Turns a period's start (ms) into its weather. */
export type WeatherLookup = (periodStart: number) => GeoFarmWeather;

/** Seeded weather by period: the same for a farm whenever it's asked. */
export function seededLookup(weatherSeed: number, config: FarmingConfig): WeatherLookup {
    const period = config.turnHours * HOUR_MS;
    return (periodStart) => rollWeather(weatherSeed, config, 1_000_000 + Math.floor(periodStart / period));
}

/** The weather of the coming turns: one, or three after Read the Sky. Each is its period's forecast. */
export function forecast(state: FarmState, config: FarmingConfig, lookup: WeatherLookup = seededLookup(state.weatherSeed, config)): GeoFarmWeather[] {
    const period = config.turnHours * HOUR_MS;
    const start = new Date(state.accruedAt).getTime();
    return Array.from({ length: state.skyRead ? 3 : 1 }, (_, i) => lookup(start + i * period));
}

const WEEK_MS = 7 * 24 * HOUR_MS;
/** 1970-01-05, a Monday: weeks run Monday 00:00 UTC to the next. */
const FIRST_MONDAY_MS = 4 * 24 * HOUR_MS;

export const weekOf = (now: Date) => Math.floor((now.getTime() - FIRST_MONDAY_MS) / WEEK_MS);
export const weekEndsAt = (week: number) => new Date(FIRST_MONDAY_MS + (week + 1) * WEEK_MS);

/** Week `week`'s server-wide event and when it runs: its last `days` days. Null for a week with none. */
export function globalEventFor(week: number, config: FarmingConfig): { eventId: string; startsAt: Date; endsAt: Date } | null {
    const choices = config.globalEvents.filter((entry) => entry.weight > 0);
    if (choices.length === 0) return null;
    let roll = createRng((Math.imul(week, 0x27d4eb2d) ^ 0x5bd1e995) >>> 0).next() * choices.reduce((sum, entry) => sum + entry.weight, 0);
    const chosen = choices.find((entry) => (roll -= entry.weight) < 0) ?? choices[choices.length - 1]!;
    const endsAt = weekEndsAt(week);
    return { eventId: chosen.eventId, startsAt: new Date(endsAt.getTime() - chosen.days * 24 * HOUR_MS), endsAt };
}

/** The server-wide event on at `now`, if any. */
export function activeGlobalEvent(now: Date, config: FarmingConfig, events: Record<string, FarmEventDef>): FarmEventDef | undefined {
    const global = globalEventFor(weekOf(now), config);
    return global && now >= global.startsAt && now < global.endsAt ? events[global.eventId] : undefined;
}

/** The crop week `week`'s crop contest is for: the plain crops in turn. */
export function contestCropFor(week: number, crops: Record<string, CropDef>): string | null {
    const ids = Object.keys(crops).sort();
    return ids.length > 0 ? ids[week % ids.length]! : null;
}

/**
 * This week's Order Board: kept while the week lasts, else a fresh set
 * (accepted orders left unfinished lose their deposit). `sellValue` prices
 * each crop as the NPCs pay, which sizes the orders. Pure.
 */
export function refreshOrders(
    state: FarmState,
    config: FarmingConfig,
    crops: Record<string, CropDef>,
    sellValue: (itemId: string) => number,
    now: Date,
): FarmState {
    const week = weekOf(now);
    if (state.orders?.week === week) return state;
    const rng = createRng((state.weatherSeed ^ Math.imul(week, 0x85ebca6b)) >>> 0);
    const { perWeek, value, rewardMultiplier, depositShare } = config.orders;
    const plain = Object.values(crops);
    const list = Array.from({ length: plain.length > 0 ? perWeek : 0 }, (_, i): GeoFarmOrder => {
        const crop = pick(rng, plain);
        const price = Math.max(1, sellValue(crop.produce));
        const target = between(rng, value);
        const quantity = Math.max(1, Math.round(target / price));
        const reward = Math.round(quantity * price * rewardMultiplier);
        return { id: `${week}-${i}`, itemId: crop.produce, quantity, delivered: 0, reward, deposit: Math.round(reward * depositShare), status: "offered" };
    });
    return { ...state, orders: { week, list } };
}

/** Coins the next tile costs, or null when every tile is owned. */
/** The next tile's price: coins rising with each one bought, and Compost from the `compostFrom`th on. Null once every tile is owned. */
export function unlockCost(state: FarmState, config: FarmingConfig): { coins: number; compost: number } | null {
    if (state.tiles.every((tile) => tile.owned)) return null;
    const { first, step, compost, compostFrom } = config.unlockCost;
    return { coins: first + step * state.unlocked, compost: state.unlocked >= compostFrom ? compost : 0 };
}

/** Locked, but sharing an edge with an owned tile. */
export function isUnlockable(state: FarmState, index: number): boolean {
    const tile = state.tiles[index];
    if (!tile || tile.owned) return false;
    const { x, y } = tileXY(index);
    return [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
    ].some(([nx, ny]) => inGrid(nx!, ny!) && state.tiles[indexOf(nx!, ny!)]!.owned);
}

export const isRipe = (crop: FarmCrop, def: GrowsDef) => !crop.rotten && crop.stage >= def.stages;

/** Chance a crop rots on the next turn: only ripe, unheld crops can. */
export function rotChance(crop: FarmCrop, def: GrowsDef, config: FarmingConfig): number {
    if (!isRipe(crop, def) || crop.held) return 0;
    const chances = config.rotChances;
    return chances[Math.min(crop.ripeTurns, chances.length - 1)]!;
}

/** Owned tiles up to `reach` steps from `index` (diagonals count one), not `index` itself. */
function around(state: FarmState, index: number, reach: number): number[] {
    const { x, y } = tileXY(index);
    const found: number[] = [];
    for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
            if ((dx === 0 && dy === 0) || !inGrid(x + dx, y + dy)) continue;
            const at = indexOf(x + dx, y + dy);
            if (state.tiles[at]!.owned) found.push(at);
        }
    }
    return found;
}

/** A structure stands on it, or covers it: nothing else can go there. A Greenhouse roof doesn't count. */
export const occupied = (tile: FarmTile) => tile.structure !== null || tile.partOf !== null;

/** The structure standing on or covering the tile at `index`. */
const structureOn = (state: FarmState, index: number) => state.tiles[state.tiles[index]!.partOf ?? index]!.structure;

/**
 * The tiles a structure of `size` covers when placed from `index`: centred
 * on it (an even side reaches one further right or down). Null when it
 * runs off the grid.
 */
export function footprint(index: number, size: { width: number; height: number }): number[] | null {
    const { x, y } = tileXY(index);
    const left = x - Math.floor((size.width - 1) / 2);
    const top = y - Math.floor((size.height - 1) / 2);
    const tiles: number[] = [];
    for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
            if (!inGrid(left + dx, top + dy)) return null;
            tiles.push(indexOf(left + dx, top + dy));
        }
    }
    return tiles;
}

/**
 * The ground on an owned tile under this turn's `weather`. A Greenhouse
 * roof over it keeps the sky off (a clear day). Wet: rain, or a Pond
 * beside it. Dry: a heatwave, unless a
 * Well's radius reaches it. Else normal.
 */
export function groundAt(state: FarmState, index: number, weather: GeoFarmWeather, structures: Record<string, StructureDef>): GeoFarmGround {
    const effectAt = (at: number) => {
        const structure = state.tiles[at]!.structure;
        return structure ? structures[structure.structureId]?.effect : undefined;
    };
    const sky = state.tiles[index]!.roof ? "clear" : weather;
    if (sky === "rain") return "wet";
    const { x, y } = tileXY(index);
    const beside = ([[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const).filter(([nx, ny]) => inGrid(nx, ny)).map(([nx, ny]) => indexOf(nx, ny));
    if (beside.some((at) => state.tiles[at]!.owned && effectAt(state.tiles[at]!.partOf ?? at)?.kind === "pond")) return "wet";
    if (sky !== "heatwave") return "normal";
    const watered = state.tiles.some((tile, at) => {
        const effect = tile.owned ? effectAt(at) : undefined;
        if (effect?.kind !== "well") return false;
        const a = tileXY(at);
        return Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) <= effect.radius;
    });
    return watered ? "normal" : "dry";
}

const pick = <T>(rng: Rng, list: T[]): T => list[Math.floor(rng.next() * list.length)]!;
const hasCrop = (state: FarmState, index: number) => Boolean(state.tiles[index]!.crop && !state.tiles[index]!.crop!.rotten);

/** A random one of `tiles`, from the ones growing a crop the pest likes if there are any. */
function pickLiked(state: FarmState, def: PestDef, tiles: number[], rng: Rng): number {
    const liked = tiles.filter((index) => def.likes.includes(state.tiles[index]!.crop?.cropId ?? ""));
    return pick(rng, liked.length > 0 ? liked : tiles);
}

/** What a pest will do on the next turn, from where it stands now. */
export function planIntent(state: FarmState, pest: FarmPest, def: PestDef, rng: Rng): GeoFarmPestIntent {
    const here = pest.tile;
    const wander = (): GeoFarmPestIntent => {
        const steps = around(state, here, 1);
        return { kind: "move", tile: steps.length > 0 ? pick(rng, steps) : here };
    };
    const behaviour = def.behaviour;
    switch (behaviour.kind) {
        case "eat": {
            if (hasCrop(state, here)) return { kind: "eat", tile: here };
            const food = around(state, here, behaviour.reach).filter((index) => hasCrop(state, index));
            return food.length > 0 ? { kind: "eat", tile: pickLiked(state, def, food, rng) } : wander();
        }
        case "sap": {
            if (hasCrop(state, here)) return { kind: "sap", tile: here };
            const food = around(state, here, 1).filter((index) => hasCrop(state, index));
            return food.length > 0 ? { kind: "move", tile: pickLiked(state, def, food, rng) } : wander();
        }
        case "breed": {
            if ((pest.age + 1) % behaviour.every === 0) {
                const taken = new Set(state.pests.map((other) => other.tile));
                const spots = around(state, here, 1).filter((index) => hasCrop(state, index) && !taken.has(index));
                if (spots.length > 0) return { kind: "breed", tile: pickLiked(state, def, spots, rng) };
            }
            if (hasCrop(state, here)) return { kind: "sap", tile: here };
            const food = around(state, here, 1).filter((index) => hasCrop(state, index));
            return food.length > 0 ? { kind: "move", tile: pickLiked(state, def, food, rng) } : wander();
        }
    }
}

const between = (rng: Rng, { min, max }: { min: number; max: number }) => min + Math.floor(rng.next() * (max - min + 1));

/**
 * A harvest's amount with Farming Fortune: × (1 + fortune / 100), so every
 * 100 adds the base amount again. The fraction left over is a chance of one
 * more: 3 crops at 50 fortune are 4.5, so 4 or 5. Negative fortune counts as 0.
 */
export function withFortune(amount: number, fortune: number, rng: Rng): number {
    const exact = amount * (1 + Math.max(0, fortune) / 100);
    const whole = Math.floor(exact);
    // No roll without a fraction, so fortune-free harvests draw what they always did.
    return exact > whole && rng.next() < exact - whole ? whole + 1 : whole;
}

/** The clock's own step: never sent by the player (`tickFarm`, `catchUp`). */
type FarmTick = { type: "tick"; weather: GeoFarmWeather };

/**
 * One step. Throws FarmRuleError for anything the player can't do now (not
 * card plays left, a tile that isn't theirs…).
 */
export function stepFarm(prev: FarmState, action: GeoFarmAction | FarmTick, ctx: FarmContext): FarmStepResult {
    const state: FarmState = structuredClone(prev);
    const rng = createRng(state.seed);
    const result: FarmStepResult = { state, log: [], gains: [], xp: 0, cardPlayed: null, coins: 0, itemsUsed: [], coinsGained: 0, harvested: [] };
    const { config, crops } = ctx;

    const tileAt = (index: number) => {
        const tile = Number.isInteger(index) ? state.tiles[index] : undefined;
        if (!tile) throw new FarmRuleError("No such tile");
        return tile;
    };
    const ownedTile = (index: number) => {
        const tile = tileAt(index);
        if (!tile.owned) throw new FarmRuleError("That tile isn't yours yet");
        return tile;
    };
    const cropDef = (crop: FarmCrop): GrowsDef => {
        const def = crops[crop.cropId] ?? ctx.mutations[crop.cropId];
        if (!def) throw new Error(`Unknown crop "${crop.cropId}"`);
        return def;
    };
    const gain = (itemId: string, quantity: number) => {
        if (quantity <= 0) return;
        const existing = result.gains.find((entry) => entry.itemId === itemId);
        if (existing) existing.quantity += quantity;
        else result.gains.push({ itemId, quantity });
    };

    /** A ripe crop into the inventory: yield from the roll, the wait and `bonus`, then Farming Fortune; seeds back rolled `seedRolls` times. */
    const harvest = (index: number, bonus: number, seedRolls = 1) => {
        const tile = state.tiles[index]!;
        const crop = tile.crop!;
        const def = cropDef(crop);
        const pushBonus = Math.min(crop.ripeTurns, config.rotChances.length);
        const event = state.activeEvent ? ctx.events[state.activeEvent.eventId] : undefined;
        const bumper = (event?.effect.kind === "bumper-harvest" ? event.effect.bonus : 0) + (blessed("plenty") ? 1 : 0);
        const amount = withFortune(Math.max(1, between(rng, def.yield) + pushBonus + bonus + bumper), ctx.fortune ?? 0, rng);
        // Mutations give no seeds back.
        let seeds = 0;
        if ("seed" in def) for (let i = 0; i < seedRolls; i++) seeds += between(rng, def.seedsBack);
        gain(def.produce, amount);
        if ("seed" in def) gain(def.seed, seeds);
        result.harvested.push({ cropId: def.id, itemId: def.produce, quantity: amount, mutation: !("seed" in def) });
        result.xp += def.xp;
        tile.crop = null;
        addCompost();
        result.log.push(`Harvested ${amount} ${def.name} at ${tileName(index)}${seeds > 0 ? ` and ${seeds} seeds` : ""}.`);
    };
    const pestDef = (pest: FarmPest) => {
        const def = ctx.pests[pest.pestId];
        if (!def) throw new Error(`Unknown pest "${pest.pestId}"`);
        return def;
    };
    /** A pest off the farm, rolling its drops. */
    const clearPest = (pest: FarmPest, how: string, log = result.log) => {
        const def = pestDef(pest);
        state.pests = state.pests.filter((other) => other.id !== pest.id);
        // Exterminator's Oath: the drops roll twice.
        const rolls = state.oath > 0 ? 2 : 1;
        if (state.oath > 0) state.oath -= 1;
        for (let roll = 0; roll < rolls; roll++) {
            for (const drop of def.drops) if (rng.chance(drop.chance)) gain(drop.itemId, between(rng, drop.quantity));
        }
        result.xp += def.xp;
        log.push(`${how} the ${def.name} at ${tileName(pest.tile)}.`);
    };
    const pestsOn = (tiles: Set<number>) => state.pests.filter((pest) => tiles.has(pest.tile));
    /** One hit: an elite pest loses a point, anything else (or an elite on its last) is cleared. */
    const hit = (pest: FarmPest, how: string, log = result.log) => {
        const left = (pest.hp ?? 1) - 1;
        if (left <= 0) return clearPest(pest, how, log);
        pest.hp = left;
        log.push(`Hit the ${pestDef(pest).name} at ${tileName(pest.tile)}: ${left} more to go.`);
    };
    const isElite = (pest: FarmPest) => (pest.hp ?? 1) > 1;
    const newPest = (def: PestDef, tile: number): FarmPest => {
        const pest: FarmPest = { id: state.nextPestId++, pestId: def.id, tile, age: 0, intent: { kind: "move", tile }, hp: def.hp };
        state.pests.push(pest);
        return pest;
    };
    const blessed = (id: BlessingId) => state.blessings.some((blessing) => blessing.id === id && blessing.turnsLeft > 0);
    /** Nuclear waste onto a tile, killing what grows there. */
    const makeWaste = (index: number, log: string[]) => {
        const tile = state.tiles[index]!;
        if (!tile.owned || occupied(tile) || tile.waste) return false;
        if (tile.crop) log.push(`Waste killed the ${cropDef(tile.crop).name} at ${tileName(index)}.`);
        tile.crop = null;
        tile.waste = true;
        return true;
    };

    const structureDef = (structure: FarmStructure) => {
        const def = ctx.structures[structure.structureId];
        if (!def) throw new Error(`Unknown structure "${structure.structureId}"`);
        return def;
    };
    /** Every structure of `kind` on the farm, with its tile. */
    const structuresOf = (kind: StructureDef["effect"]["kind"]) =>
        state.tiles.flatMap((tile, index) =>
            tile.owned && tile.structure && structureDef(tile.structure).effect.kind === kind ? [{ index, structure: tile.structure, def: structureDef(tile.structure) }] : [],
        );
    const structureAt = (index: number, kind: StructureDef["effect"]["kind"]) => {
        ownedTile(index);
        const structure = structureOn(state, index);
        if (!structure || structureDef(structure).effect.kind !== kind) return null;
        return structure;
    };
    /** Crop waste (a harvest or clear) into every Compost Bin; a full one turns it into its Compost item. */
    const addCompost = () => {
        for (const { structure, def } of structuresOf("compost")) {
            if (def.effect.kind !== "compost") continue;
            structure.compost += 1;
            if (structure.compost < def.effect.capacity) continue;
            structure.compost = 0;
            gain(def.effect.itemId, 1);
        }
    };
    const noStructure = (tile: FarmTile) => {
        if (occupied(tile)) throw new FarmRuleError("A structure stands there");
        return tile;
    };

    const ripeAt = (index: number) => {
        const crop = ownedTile(index).crop;
        if (!crop || crop.rotten) throw new FarmRuleError(crop ? "It's rotten. Clear it." : "Nothing grows there");
        if (!isRipe(crop, cropDef(crop))) throw new FarmRuleError("It isn't ripe yet");
        return crop;
    };

    /** What pests did each turn, logged after the growth line. */
    const pestNotes: string[] = [];

    switch (action.type) {
        case "plant": {
            const tile = noStructure(ownedTile(action.tile));
            if (tile.crop) throw new FarmRuleError("Something already grows there");
            if (tile.waste) throw new FarmRuleError("Nothing grows in nuclear waste. Scrub it first");
            const def = Object.values(crops).find((crop) => crop.seed === action.itemId);
            if (!def) throw new FarmRuleError("Those aren't seeds that grow");
            if ((ctx.held[action.itemId] ?? 0) < 1) throw new FarmRuleError("You have none of those seeds");
            tile.crop = { cropId: def.id, stage: 0, ripeTurns: 0, held: false, rotten: false };
            result.itemsUsed.push({ itemId: action.itemId, quantity: 1 });
            result.log.push(`Planted ${def.name} at ${tileName(action.tile)}.`);
            break;
        }
        case "plant-all": {
            // Planned tiles take their planned crop's seed; the rest take `itemId`, while seeds last.
            const left = { ...ctx.held };
            const seedFor = (cropId: string | null) => (cropId ? crops[cropId]?.seed : undefined);
            if (action.itemId !== null && !Object.values(crops).some((crop) => crop.seed === action.itemId)) throw new FarmRuleError("Those aren't seeds that grow");
            const used = new Map<string, number>();
            const planted = new Map<string, number>();
            const empty = state.tiles.flatMap((tile, index) => (tile.owned && !tile.crop && !tile.waste && !occupied(tile) ? [index] : []));
            // Planned tiles first, so a plan isn't starved by a plain fill.
            empty.sort((a, b) => Number(state.tiles[b]!.blueprint !== null) - Number(state.tiles[a]!.blueprint !== null));
            for (const index of empty) {
                const tile = state.tiles[index]!;
                const planned = seedFor(tile.blueprint);
                const seed = planned && (left[planned] ?? 0) > 0 ? planned : action.itemId;
                if (!seed || (left[seed] ?? 0) < 1) continue;
                const def = Object.values(crops).find((crop) => crop.seed === seed)!;
                tile.crop = { cropId: def.id, stage: 0, ripeTurns: 0, held: false, rotten: false };
                left[seed] = (left[seed] ?? 0) - 1;
                used.set(seed, (used.get(seed) ?? 0) + 1);
                planted.set(def.name, (planted.get(def.name) ?? 0) + 1);
            }
            if (used.size === 0) throw new FarmRuleError(empty.length === 0 ? "No empty tiles to plant" : "You have none of those seeds");
            for (const [itemId, quantity] of used) result.itemsUsed.push({ itemId, quantity });
            result.log.push(`Planted ${[...planted].map(([name, count]) => `${count} ${name}`).join(" and ")}.`);
            break;
        }
        case "harvest": {
            ripeAt(action.tile);
            harvest(action.tile, 0);
            break;
        }
        case "harvest-all": {
            const ripe = state.tiles.flatMap((tile, index) => (tile.owned && tile.crop && isRipe(tile.crop, cropDef(tile.crop)) ? [index] : []));
            if (ripe.length === 0) throw new FarmRuleError("Nothing is ripe");
            for (const index of ripe) harvest(index, 0);
            break;
        }
        case "clear": {
            const tile = ownedTile(action.tile);
            if (!tile.crop) throw new FarmRuleError("Nothing grows there");
            result.log.push(`Cleared the ${tile.crop.rotten ? "rotten " : ""}${cropDef(tile.crop).name} at ${tileName(action.tile)}.`);
            tile.crop = null;
            addCompost();
            break;
        }
        case "place": {
            ownedTile(action.tile);
            const def = ctx.structures[action.structureId];
            if (!def) throw new FarmRuleError("That isn't a farm structure");
            if (ctx.farmingLevel < def.requiredLevel) throw new FarmRuleError(`A ${def.name} needs farming level ${def.requiredLevel} (you're ${ctx.farmingLevel})`);
            const short = def.cost.find((entry) => (ctx.held[entry.itemId] ?? 0) < entry.quantity);
            if (short) throw new FarmRuleError(`A ${def.name} needs ${short.quantity} ${ctx.itemName(short.itemId)}; you have ${ctx.held[short.itemId] ?? 0}`);
            const { width, height } = def.size;
            const big = width * height > 1;
            const tiles = footprint(action.tile, def.size);
            if (!tiles) throw new FarmRuleError(`A ${def.name} is ${width}×${height}: it runs off the farm from there`);
            // A roof goes over crops; anything else needs the ground clear.
            const roof = def.effect.kind === "greenhouse";
            for (const at of tiles) {
                const tile = state.tiles[at]!;
                if (!tile.owned) throw new FarmRuleError(big ? `A ${def.name} is ${width}×${height}: every tile under it must be yours` : "That tile isn't yours yet");
                if (occupied(tile) || tile.roof) throw new FarmRuleError(big ? `A structure stands in the way at ${tileName(at)}` : "A structure stands there");
                if (tile.waste) throw new FarmRuleError("Scrub the waste off first");
                if (roof) continue;
                if (tile.crop) throw new FarmRuleError("Clear the crop first");
                if (state.pests.some((pest) => pest.tile === at)) throw new FarmRuleError("Deal with the pests there first");
            }
            if (roof) {
                for (const at of tiles) state.tiles[at]!.roof = { anchor: action.tile, structureId: def.id };
            } else {
                state.tiles[action.tile]!.structure = { structureId: def.id, tune: null, caged: null, compost: 0, open: false };
                for (const at of tiles) if (at !== action.tile) state.tiles[at]!.partOf = action.tile;
            }
            result.itemsUsed.push(...def.cost);
            result.log.push(`Built a ${def.name} at ${tileName(action.tile)}.`);
            break;
        }
        case "demolish": {
            const tile = ownedTile(action.tile);
            const at = tile.partOf ?? action.tile;
            const structure = state.tiles[at]!.structure;
            if (structure) {
                if (structure.caged) throw new FarmRuleError("Let the pest out first");
                const def = structureDef(structure);
                state.tiles[at]!.structure = null;
                for (const entry of state.tiles) if (entry.partOf === at) entry.partOf = null;
                result.log.push(`Tore down the ${def.name}.`);
            } else if (tile.roof) {
                const { anchor, structureId } = tile.roof;
                const def = ctx.structures[structureId];
                if (!def) throw new Error(`Unknown structure "${structureId}"`);
                for (const entry of state.tiles) if (entry.roof?.anchor === anchor) entry.roof = null;
                result.log.push(`Tore down the ${def.name}; what grew under it is in the open now.`);
            } else {
                throw new FarmRuleError("No structure there");
            }
            break;
        }
        case "tune": {
            const jukebox = structureAt(action.tile, "jukebox");
            if (!jukebox) throw new FarmRuleError("No Jukebox there");
            if (action.pestId !== null && !ctx.pests[action.pestId]) throw new FarmRuleError("No pest has that tune");
            jukebox.tune = action.pestId;
            result.log.push(action.pestId ? `The Jukebox plays the ${ctx.pests[action.pestId]!.name}'s tune.` : "The Jukebox falls quiet.");
            break;
        }
        case "cage": {
            ownedTile(action.tile);
            const pest = state.pests.find((entry) => entry.tile === action.tile && !isElite(entry));
            if (!pest) throw new FarmRuleError(state.pests.some((entry) => entry.tile === action.tile) ? "That one's too strong to cage" : "No pest there");
            const cage = [action.tile, ...around(state, action.tile, 1)]
                .map((index) => structureAt(index, "cage"))
                .find((structure) => structure && !structure.caged);
            if (!cage) throw new FarmRuleError("Needs an empty Pest Cage on or next to the tile");
            cage.caged = pest.pestId;
            state.pests = state.pests.filter((other) => other.id !== pest.id);
            result.log.push(`Caged the ${pestDef(pest).name}.`);
            break;
        }
        case "release": {
            const cage = structureAt(action.tile, "cage");
            if (!cage?.caged) throw new FarmRuleError("No caged pest there");
            const pestId = cage.caged;
            cage.caged = null;
            clearPest({ id: -1, pestId, tile: action.tile, age: 0, intent: { kind: "move", tile: action.tile } }, "Let out and cleared");
            break;
        }
        case "turn-in": {
            const cage = structureAt(action.tile, "cage");
            if (!cage?.caged) throw new FarmRuleError("No caged pest there");
            const def = ctx.pests[cage.caged];
            if (!def) throw new Error(`Unknown pest "${cage.caged}"`);
            cage.caged = null;
            const bounty = def.bounty;
            state.pesthunterPoints += bounty;
            result.log.push(`The Pesthunter took the ${def.name}. +${bounty} Pesthunter point${bounty === 1 ? "" : "s"}.`);
            break;
        }
        case "pesthunter-buy": {
            const offer = config.pesthunter.shop[action.offer];
            if (!offer) throw new FarmRuleError("The Pesthunter doesn't sell that");
            if (state.pesthunterPoints < offer.price) throw new FarmRuleError(`That needs ${offer.price} Pesthunter points; you have ${state.pesthunterPoints}`);
            state.pesthunterPoints -= offer.price;
            gain(offer.itemId, 1);
            result.log.push(`Traded ${offer.price} Pesthunter points with the Pesthunter.`);
            break;
        }
        case "offer": {
            if (!structureAt(action.tile, "shrine")) throw new FarmRuleError("No Shrine there");
            if (!Number.isInteger(action.quantity) || action.quantity < 1) throw new FarmRuleError("Offer at least one");
            if ((ctx.held[action.itemId] ?? 0) < action.quantity) throw new FarmRuleError("You don't have that many");
            const value = ctx.sellValue(action.itemId) * action.quantity;
            if (value <= 0) throw new FarmRuleError("The Shrine wants nothing to do with that");
            result.itemsUsed.push({ itemId: action.itemId, quantity: action.quantity });
            const { halfValue, curseShare, blessings } = config.shrine;
            const answer = (curse: boolean) => {
                const choices = blessings.filter((entry) => entry.curse === curse && entry.weight > 0);
                let roll = rng.next() * choices.reduce((sum, entry) => sum + entry.weight, 0);
                const chosen = choices.find((entry) => (roll -= entry.weight) < 0) ?? choices[choices.length - 1];
                if (!chosen) return;
                const existing = state.blessings.find((entry) => entry.id === chosen.id);
                if (existing) existing.turnsLeft = Math.max(existing.turnsLeft, chosen.turns);
                else state.blessings.push({ id: chosen.id, turnsLeft: chosen.turns });
                result.log.push(`The Shrine answers: ${chosen.name}. ${chosen.description}`);
            };
            if (rng.chance(value / (value + halfValue))) {
                answer(false);
            } else {
                if (rng.chance(curseShare)) answer(true);
                else result.log.push("The Shrine takes it in silence.");
            }
            break;
        }
        case "buy": {
            const offer = state.activeEvent?.offers[action.offer];
            if (!offer) throw new FarmRuleError("Nobody's selling that");
            if (offer.bought) throw new FarmRuleError("You've bought that already");
            offer.bought = true;
            result.coins = offer.price;
            gain(offer.itemId, 1);
            result.log.push("Bought from the Travelling Merchant.");
            break;
        }
        case "accept-order": {
            const order = state.orders?.list.find((entry) => entry.id === action.orderId);
            if (!order) throw new FarmRuleError("That order isn't on the board");
            if (order.status !== "offered") throw new FarmRuleError("You've taken that order already");
            order.status = "accepted";
            result.coins = order.deposit;
            result.log.push(`Took the order: ${order.quantity} by the week's end.`);
            break;
        }
        case "deliver-order": {
            const order = state.orders?.list.find((entry) => entry.id === action.orderId);
            if (!order || order.status !== "accepted") throw new FarmRuleError("Take the order on first");
            const handing = Math.min(ctx.held[order.itemId] ?? 0, order.quantity - order.delivered);
            if (handing <= 0) throw new FarmRuleError("You have none of that to hand in");
            order.delivered += handing;
            if (handing > 0) result.itemsUsed.push({ itemId: order.itemId, quantity: handing });
            if (order.delivered >= order.quantity) {
                order.status = "done";
                result.coinsGained = order.reward + order.deposit;
                result.log.push(`Order complete: +${order.reward} coins, and the ${order.deposit} deposit back.`);
            } else {
                result.log.push(`Handed in ${handing}: ${order.quantity - order.delivered} to go.`);
            }
            break;
        }
        case "play": {
            const card = ctx.hand.find((entry) => entry.inventoryId === action.inventoryId);
            if (!card) throw new FarmRuleError("That card isn't in your farming hand");
            if (card.chargesLeft <= 0) throw new FarmRuleError("That card has faded");
            if (!isFarmingCardId(card.cardId)) throw new FarmRuleError("That isn't a farming card");
            if (state.played.includes(card.inventoryId)) throw new FarmRuleError("That card has been played this cycle; it's ready again next cycle");
            if (playsLeft(state) <= 0) throw new FarmRuleError(`You've played ${GEO_HAND_SIZE} cards this cycle; they're ready again next cycle`);
            playCard(card.cardId, action.tile);
            state.played.push(card.inventoryId);
            result.cardPlayed = { inventoryId: card.inventoryId, chargesLeft: card.chargesLeft - 1 };
            break;
        }
        case "tick": {
            advance(action.weather);
            break;
        }
        case "unlock": {
            if (!isUnlockable(state, action.tile)) throw new FarmRuleError("Only a locked tile next to your farm can be bought");
            const price = unlockCost(state, config)!;
            const compostItem = config.unlockCost.itemId;
            if ((ctx.held[compostItem] ?? 0) < price.compost) {
                throw new FarmRuleError(`That tile needs ${price.compost} ${ctx.itemName(compostItem)}; you have ${ctx.held[compostItem] ?? 0}. A Compost Bin makes it`);
            }
            result.coins = price.coins;
            if (price.compost > 0) result.itemsUsed.push({ itemId: compostItem, quantity: price.compost });
            state.tiles[action.tile]!.owned = true;
            state.unlocked += 1;
            result.log.push(`Bought the tile at ${tileName(action.tile)}.`);
            break;
        }
        case "blueprint": {
            const tile = tileAt(action.tile);
            if (action.cropId !== null && !crops[action.cropId]) throw new FarmRuleError("Unknown crop");
            tile.blueprint = action.cropId;
            break;
        }
    }

    state.seed = newSeed(rng);
    return result;

    function playCard(cardId: FarmingCardId, index: number) {
        switch (cardId) {
            case "farm.swat": {
                ownedTile(index);
                const here = pestsOn(new Set([index]));
                if (here.length === 0) throw new FarmRuleError("No pests there");
                for (const pest of here) hit(pest, "Swatted");
                return;
            }
            case "farm.careful-pick": {
                ripeAt(index);
                harvest(index, 1);
                return;
            }
            case "farm.scythe-sweep": {
                const { x, y } = tileXY(index);
                tileAt(index);
                const ripe: number[] = [];
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!inGrid(x + dx, y + dy)) continue;
                        const at = indexOf(x + dx, y + dy);
                        const crop = state.tiles[at]!.crop;
                        if (state.tiles[at]!.owned && crop && isRipe(crop, cropDef(crop))) ripe.push(at);
                    }
                }
                if (ripe.length === 0) throw new FarmRuleError("Nothing ripe in reach of the scythe");
                for (const at of ripe) harvest(at, 0, 2);
                return;
            }
            case "farm.ripen": {
                const tile = ownedTile(index);
                const crop = tile.crop;
                if (!crop || crop.rotten || isRipe(crop, cropDef(crop))) throw new FarmRuleError("Ripen needs a growing crop");
                crop.stage += 1;
                result.log.push(`${cropDef(crop).name} at ${tileName(index)} grew a stage.`);
                return;
            }
            case "farm.hold": {
                const crop = ripeAt(index);
                crop.held = true;
                result.log.push(`${cropDef(crop).name} at ${tileName(index)} is held for a cycle.`);
                return;
            }
            case "farm.read-sky": {
                state.skyRead = true;
                result.log.push("You read the sky: three cycles of weather ahead.");
                return;
            }
            case "farm.smoke": {
                tileAt(index);
                const reach = new Set([index, ...around(state, index, 1)]);
                const caught = pestsOn(reach);
                if (caught.length === 0) throw new FarmRuleError("No pests in reach of the smoke");
                for (const pest of caught) hit(pest, "Smoked out");
                for (const at of reach) {
                    const crop = state.tiles[at]!.crop;
                    if (crop && crop.ripeTurns > 0) crop.ripeTurns = 0;
                }
                return;
            }
            case "farm.bait-ring": {
                ownedTile(index);
                const pulled = pestsOn(new Set(around(state, index, 1)));
                if (pulled.length === 0) throw new FarmRuleError("No pests around to draw in");
                for (const pest of pulled) {
                    pest.tile = index;
                    pest.intent = planIntent(state, pest, pestDef(pest), rng);
                }
                result.log.push(`Bait Ring drew ${pulled.length} pest${pulled.length === 1 ? "" : "s"} onto ${tileName(index)}.`);
                return;
            }
            case "farm.hand-pollinate": {
                const tile = ownedTile(index);
                if (tile.crop || occupied(tile)) throw new FarmRuleError("Hand Pollinate needs an empty tile for something to sprout on");
                tile.pollinated = true;
                for (const at of around(state, index, 1)) {
                    const crop = state.tiles[at]!.crop;
                    if (crop && crop.ripeTurns > 0) crop.ripeTurns = 0;
                }
                result.log.push(`Hand pollinated around ${tileName(index)}.`);
                return;
            }
            case "farm.coax": {
                const tile = noStructure(ownedTile(index));
                if (tile.crop || tile.waste) throw new FarmRuleError("Coax needs an empty tile");
                // As things will stand on the coming turn: its weather and events.
                const weather = nextWeather(state, ctx);
                const holding = Object.values(ctx.mutations).filter((mutation) => recipeHolds(index, mutation, weather, [state.nextEvent ?? undefined, ctx.globalEvent?.id]));
                const sprouted = holding.find((mutation) => rng.chance(mutation.chance * COAX_SHARE * (ctx.mutationChance ?? 1)));
                if (sprouted) {
                    tile.crop = { cropId: sprouted.id, stage: 0, ripeTurns: 0, held: false, rotten: false };
                    result.log.push(`Coaxed something out at ${tileName(index)}: ${sprouted.name}!`);
                } else {
                    result.log.push(`Nothing came of it at ${tileName(index)}.`);
                }
                return;
            }
            case "farm.moon-rite": {
                const moon = ctx.events["blood-moon"];
                if (!moon) throw new FarmRuleError("The moon won't answer");
                state.nextEvent = moon.id;
                result.log.push("The rite is done. The next cycle comes under a Blood Moon.");
                return;
            }
            case "farm.exterminators-oath": {
                state.oath += 3;
                result.log.push("You swear the oath: the next 3 pests cleared drop twice.");
                return;
            }
            case "farm.chain-reaction": {
                const wasted = state.tiles.flatMap((tile, at) => (tile.owned && tile.waste ? [at] : []));
                if (wasted.length === 0) throw new FarmRuleError("There's no waste to set off");
                const mutations = Object.values(ctx.mutations);
                const glow = ctx.pests[config.waste.pest];
                for (const at of wasted) {
                    const tile = state.tiles[at]!;
                    if (mutations.length > 0 && rng.chance(CHAIN_REACTION_CHANCE)) {
                        const mutation = pick(rng, mutations);
                        tile.waste = false;
                        tile.crop = { cropId: mutation.id, stage: 0, ripeTurns: 0, held: false, rotten: false };
                        result.log.push(`The waste at ${tileName(at)} burned into ${mutation.name}!`);
                    } else if (glow) {
                        newPest(glow, at);
                        result.log.push(`The waste at ${tileName(at)} fizzled: a ${glow.name} crawled out.`);
                    }
                }
                return;
            }
            case "farm.hazmat-scrub": {
                const tile = ownedTile(index);
                if (!tile.waste) throw new FarmRuleError("There's no waste there");
                tile.waste = false;
                result.log.push(`Scrubbed the waste off ${tileName(index)}.`);
                return;
            }
            case "farm.controlled-leak": {
                ownedTile(index);
                const { x, y } = tileXY(index);
                const beside = ([[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const).filter(([nx, ny]) => inGrid(nx, ny)).map(([nx, ny]) => indexOf(nx, ny));
                const leaked = beside.filter((at) => makeWaste(at, result.log)).length;
                if (leaked === 0) throw new FarmRuleError("Nowhere beside it for the waste to go");
                result.log.push(`Leaked waste onto ${leaked} tile${leaked === 1 ? "" : "s"} around ${tileName(index)}.`);
                return;
            }
            case "farm.tear-the-veil": {
                const portal = structureAt(index, "portal");
                if (!portal) throw new FarmRuleError("Tear the Veil needs a Portal");
                if (portal.open) throw new FarmRuleError("It's already open");
                portal.open = true;
                result.log.push("The Portal tears open. Something is coming through on the next cycle.");
                return;
            }
            case "farm.snap-trap": {
                const tile = ownedTile(index);
                if (tile.trap) throw new FarmRuleError("There's a trap there already");
                tile.trap = true;
                result.log.push(`Set a Snap Trap at ${tileName(index)}.`);
                return;
            }
        }
    }

    /** Everything moves on one turn: weather, growth, ripe crops' push-your-luck. */
    function advance(weather: GeoFarmWeather) {
        const event = state.nextEvent ? ctx.events[state.nextEvent] : undefined;
        state.nextEvent = null;
        state.activeEvent = null;
        const global = ctx.globalEvent;
        if (event) result.log.push(`${event.name}! ${event.description}`);
        if (global) result.log.push(`${global.name}, everywhere! ${global.description}`);
        state.turn += 1;
        state.played = [];
        state.skyRead = false;

        frogsEat();
        const sapped = actPests();

        let grew = 0;
        let dry = 0;
        const notes: string[] = [];
        /** What the player's setup did this cycle, credited after the growth line. */
        const credit = { roofed: 0, watered: 0, reactor: 0 };

        // Tiles under a Greenhouse roof are sheltered: they grow as on a clear day.
        const sheltered = new Set(state.tiles.flatMap((tile, index) => (tile.owned && tile.roof ? [index] : [])));
        const skyOver = (index: number): GeoFarmWeather => (sheltered.has(index) ? "clear" : weather);
        // Reactors: extra stages for crops in range.
        const reactors = structuresOf("reactor");
        const boosted = (index: number) =>
            reactors.reduce((extra, { index: at, def }) => {
                if (def.effect.kind !== "reactor") return extra;
                const a = tileXY(index);
                const b = tileXY(at);
                return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= def.effect.radius ? Math.max(extra, def.effect.growth) : extra;
            }, 0);
        for (const { index, def } of structuresOf("beehive")) {
            if (def.effect.kind !== "beehive" || !rng.chance(def.effect.swarmChance)) continue;
            for (const at of around(state, index, 1)) sapped.add(at);
            notes.push(`The bees swarmed at ${tileName(index)}: the crops around won't grow this cycle.`);
        }
        for (const [index, tile] of state.tiles.entries()) {
            if (!tile.owned) continue;

            const crop = tile.crop;
            if (crop && !crop.rotten) {
                const def = cropDef(crop);
                if (isRipe(crop, def)) {
                    if (crop.held) {
                        crop.held = false;
                    } else if (rng.chance(rotChance(crop, def, config))) {
                        crop.rotten = true;
                        notes.push(`The ${def.name} at ${tileName(index)} rotted.`);
                    } else {
                        crop.ripeTurns = Math.min(crop.ripeTurns + 1, config.rotChances.length);
                    }
                } else if (sapped.has(index) || skyOver(index) === "frost") {
                    // Sapped or frozen: no growth.
                } else if (groundAt(state, index, weather, ctx.structures) === "dry") {
                    dry += 1;
                } else {
                    crop.stage = Math.min(def.stages, crop.stage + 1 + boosted(index) + (blessed("growth") ? 1 : 0));
                    grew += 1;
                    // Frost or an open heatwave would have stopped it: the roof kept it growing.
                    if ((weather === "frost" || weather === "heatwave") && sheltered.has(index)) credit.roofed += 1;
                    // In an open heatwave only a Well or Pond keeps a crop off dry ground.
                    if (skyOver(index) === "heatwave") credit.watered += 1;
                    if (boosted(index) > 0) credit.reactor += 1;
                    if (isRipe(crop, def)) notes.push(`The ${def.name} at ${tileName(index)} is ripe.`);
                }
            }
            // A trap lasts one turn, caught or not.
            tile.trap = false;
        }

        const label = weather[0]!.toUpperCase() + weather.slice(1);
        result.log.push(`Cycle ${state.turn}: ${label}. ${grew} crop${grew === 1 ? "" : "s"} grew${dry ? `, ${dry} too dry to grow` : ""}.`);
        const crops = (count: number) => `${count} crop${count === 1 ? "" : "s"}`;
        const credits = [
            credit.roofed > 0 ? `Your Greenhouse kept ${crops(credit.roofed)} growing through the ${weather}.` : "",
            credit.watered > 0 ? `Your Wells and Ponds kept ${crops(credit.watered)} growing through the heatwave.` : "",
            credit.reactor > 0 ? `The Reactor pushed ${crops(credit.reactor)} an extra stage.` : "",
        ].filter(Boolean);
        result.log.push(...credits, ...notes, ...pestNotes);

        const meteor = [event, global].find((entry) => entry?.effect.kind === "meteor-shower");
        if (meteor?.effect.kind === "meteor-shower") {
            for (const [index, tile] of state.tiles.entries()) {
                if (!tile.owned || tile.crop || occupied(tile) || !rng.chance(meteor.effect.dropChance)) continue;
                gain(meteor.effect.itemId, 1);
                result.log.push(`Something fell at ${tileName(index)}, still glowing.`);
            }
        }
        sproutMutations(weather, sheltered, event);

        const pestBoost =
            [event, global].reduce((boost, entry) => (entry?.effect.kind === "blood-moon" ? boost * entry.effect.pestBoost : boost), 1) *
            (blessed("pests") ? 2 : 1);
        spawnPest(sheltered, pestBoost, false);
        if (event?.effect.kind === "pest-swarm") for (let i = 0; i < event.effect.count; i++) spawnPest(sheltered, 1, true);

        if (event?.effect.kind === "bumper-harvest") state.activeEvent = { eventId: event.id, offers: [] };
        if (event?.effect.kind === "merchant") {
            const stock = [...event.effect.stock];
            const offers = Array.from({ length: Math.min(event.effect.count, stock.length) }, () => {
                const offer = stock.splice(Math.floor(rng.next() * stock.length), 1)[0]!;
                return { ...offer, bought: false };
            });
            state.activeEvent = { eventId: event.id, offers };
        }
        atomicAge();
        openPortals();
        rollNextEvent();
        for (const pest of state.pests) pest.intent = planIntent(state, pest, pestDef(pest), rng);
        for (const blessing of state.blessings) blessing.turnsLeft -= 1;
        state.blessings = state.blessings.filter((blessing) => blessing.turnsLeft > 0);
    }

    /** Each Pond's frog eats one pest on or around it, before pests act. No drops: the frog had them. */
    function frogsEat() {
        for (const { index } of structuresOf("pond")) {
            const reach = new Set([index, ...around(state, index, 1)]);
            // An elite is more than a frog can swallow.
            const near = pestsOn(reach).filter((pest) => !isElite(pest));
            if (near.length === 0) continue;
            const eaten = pick(rng, near);
            state.pests = state.pests.filter((pest) => pest.id !== eaten.id);
            pestNotes.push(`The frog in the Pond at ${tileName(index)} ate the ${pestDef(eaten).name}.`);
        }
    }

    /** Every pest makes its telegraphed move. Returns the tiles whose crops were sapped. */
    function actPests(): Set<number> {
        const sapped = new Set<number>();
        const trapped = (pest: FarmPest) => {
            const tile = state.tiles[pest.tile]!;
            if (!tile.trap) return false;
            tile.trap = false;
            hit(pest, "Snap Trap caught", pestNotes);
            const caught = !state.pests.includes(pest);
            if (caught && tile.crop && !tile.crop.rotten) pestNotes.push(`Your Snap Trap saved the ${cropDef(tile.crop).name} there.`);
            return caught;
        };
        for (const pest of [...state.pests]) {
            const def = pestDef(pest);
            const intent = pest.intent;
            pest.age += 1;
            if ((intent.kind === "eat" || intent.kind === "move") && intent.tile !== pest.tile && state.tiles[intent.tile]?.owned) {
                pest.tile = intent.tile;
                if (trapped(pest)) continue;
            }
            const tile = state.tiles[pest.tile]!;
            switch (intent.kind) {
                case "eat": {
                    if (pest.tile !== intent.tile || !tile.crop || tile.crop.rotten) {
                        pestNotes.push(`The ${def.name} found nothing to eat.`);
                        break;
                    }
                    pestNotes.push(`The ${def.name} ate the ${cropDef(tile.crop).name} at ${tileName(pest.tile)}.`);
                    tile.crop = null;
                    break;
                }
                case "sap":
                    sapped.add(pest.tile);
                    break;
                case "breed": {
                    sapped.add(pest.tile);
                    if (!state.tiles[intent.tile]?.owned) break;
                    const young = newPest(def, intent.tile);
                    pestNotes.push(`The ${def.name} bred onto ${tileName(intent.tile)}.`);
                    trapped(young);
                    break;
                }
                case "move":
                    break;
            }
        }
        return sapped;
    }

    /** Waste spreads, Reactors leak more, and glowing pests crawl out of it. */
    function atomicAge() {
        const { spreadChance, pestChance, pest } = config.waste;
        const wasted = state.tiles.flatMap((tile, index) => (tile.owned && tile.waste ? [index] : []));
        for (const index of wasted) {
            if (!rng.chance(spreadChance)) continue;
            const { x, y } = tileXY(index);
            const beside = ([[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const).filter(([nx, ny]) => inGrid(nx, ny)).map(([nx, ny]) => indexOf(nx, ny));
            const open = beside.filter((at) => state.tiles[at]!.owned && !occupied(state.tiles[at]!) && !state.tiles[at]!.waste);
            if (open.length > 0 && makeWaste(pick(rng, open), result.log)) result.log.push(`The waste at ${tileName(index)} spread.`);
        }
        for (const { index, def } of structuresOf("reactor")) {
            if (def.effect.kind !== "reactor" || !rng.chance(def.effect.wasteChance)) continue;
            const radius = def.effect.radius;
            const { x, y } = tileXY(index);
            const candidates = state.tiles.flatMap((tile, at) => {
                const p = tileXY(at);
                return Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= radius && tile.owned && !occupied(tile) && !tile.waste ? [at] : [];
            });
            if (candidates.length > 0) {
                const at = pick(rng, candidates);
                makeWaste(at, result.log);
                result.log.push(`The Reactor leaked: waste at ${tileName(at)}.`);
            }
        }
        const glow = ctx.pests[pest];
        if (!glow) return;
        for (const index of wasted) {
            if (state.pests.length >= config.pests.max * 2 || !rng.chance(pestChance)) continue;
            newPest(glow, index);
            result.log.push(`A ${glow.name} crawled out of the waste at ${tileName(index)}.`);
        }
    }

    /** Each torn-open Portal lets its wave of elite pests through, then shuts. */
    function openPortals() {
        for (const { index, structure, def } of structuresOf("portal")) {
            if (!structure.open || def.effect.kind !== "portal") continue;
            structure.open = false;
            const spots = around(state, index, 1);
            for (let i = 0; i < def.effect.wave; i++) {
                const elite = ctx.pests[pick(rng, def.effect.pests)];
                if (!elite) continue;
                newPest(elite, spots.length > 0 ? pick(rng, spots) : index);
                result.log.push(`A ${elite.name} came through the Portal.`);
            }
        }
    }

    /** Maybe telegraph an event for the next turn. */
    function rollNextEvent() {
        // Weight 0: a global-only event, never rolled on one farm.
        const events = Object.values(ctx.events).filter((entry) => entry.weight > 0);
        if (events.length === 0 || state.turn + 1 < config.events.fromTurn || !rng.chance(config.events.chance)) return;
        let roll = rng.next() * events.reduce((sum, entry) => sum + entry.weight, 0);
        const next = events.find((entry) => (roll -= entry.weight) < 0) ?? events[events.length - 1]!;
        state.nextEvent = next.id;
        result.log.push(`Coming next cycle: ${next.name}.`);
    }

    /** What a recipe asked for, in words, to credit the player's setup when it sprouts. */
    function recipeCredit(mutation: MutationDef): string {
        const recipe = mutation.recipe;
        const parts = recipe.parents.map((parent) => `${parent.count} ripe ${ctx.crops[parent.cropId]?.name ?? parent.cropId}`);
        if (recipe.weather) parts.push(`the ${recipe.weather}`);
        if (recipe.event) parts.push(`the ${ctx.events[recipe.event]?.name ?? recipe.event}`);
        if (recipe.pest) parts.push(`the ${ctx.pests[recipe.pest]?.name ?? recipe.pest}`);
        if (recipe.structure) parts.push(`your ${ctx.structures[recipe.structure]?.name ?? recipe.structure}`);
        if (recipe.ground) parts.push(`${recipe.ground} ground`);
        if (recipe.blessing) parts.push(`the ${config.shrine.blessings.find((entry) => entry.id === recipe.blessing)?.name ?? recipe.blessing}`);
        return parts.join(" + ");
    }

    /** Does `mutation`'s recipe hold around the empty tile at `index`, in this weather, with these events on? */
    function recipeHolds(index: number, mutation: MutationDef, weather: GeoFarmWeather, events: (string | undefined)[]): boolean {
        const recipe = mutation.recipe;
        const nearby = around(state, index, 1);
        if (recipe.weather && recipe.weather !== weather) return false;
        if (recipe.event && !events.includes(recipe.event)) return false;
        if (recipe.blessing && !blessed(recipe.blessing as BlessingId)) return false;
        if (recipe.structure && !nearby.some((at) => structureOn(state, at)?.structureId === recipe.structure)) return false;
        if (recipe.ground && groundAt(state, index, weather, ctx.structures) !== recipe.ground) return false;
        if (recipe.pest) {
            const pestId = recipe.pest;
            const near =
                state.pests.some((pest) => pest.pestId === pestId && (pest.tile === index || nearby.includes(pest.tile))) ||
                nearby.some((at) => structureOn(state, at)?.caged === pestId);
            if (!near) return false;
        }
        const ripeAround = (cropId: string) =>
            nearby.filter((at) => {
                const crop = state.tiles[at]!.crop;
                return crop?.cropId === cropId && isRipe(crop, cropDef(crop));
            }).length;
        return recipe.parents.every((parent) => ripeAround(parent.cropId) >= parent.count);
    }

    /** Every empty tile whose surroundings meet a recipe rolls for that mutation; at most one sprouts per tile. */
    function sproutMutations(weather: GeoFarmWeather, sheltered: Set<number>, event: FarmEventDef | undefined) {
        const global = ctx.globalEvent;
        const meteor = [event, global].find((entry) => entry?.effect.kind === "meteor-shower");
        const recipes = Object.values(ctx.mutations);
        const beehives = structuresOf("beehive");
        const hiveBoost = Math.max(1, ...beehives.map(({ def }) => (def.effect.kind === "beehive" ? def.effect.boost : 1)));
        const before = state.setups;
        state.setups = [];
        for (const [index, tile] of state.tiles.entries()) {
            const pollinated = tile.pollinated;
            tile.pollinated = false;
            // Wild outcomes happen in the open field, never under glass.
            if (!tile.owned || tile.crop || occupied(tile) || tile.waste || sheltered.has(index)) continue;
            const nearby = around(state, index, 1);
            const hived = beehives.some((hive) => hive.index === index || nearby.includes(hive.index));
            const wasted = nearby.some((at) => state.tiles[at]!.waste);
            const held: FarmSetup[] = [];
            for (const mutation of recipes) {
                if (!recipeHolds(index, mutation, weather, [event?.id, global?.id])) continue;
                const meteorBoost = meteor?.effect.kind === "meteor-shower" ? meteor.effect.mutationBoost : 1;
                const wasteBoost = wasted ? config.waste.mutationBoost : 1;
                const boost =
                    (pollinated ? config.pollinateBoost : 1) * (hived ? hiveBoost : 1) * meteorBoost * wasteBoost * (blessed("mutation") ? 2 : 1) * (ctx.mutationChance ?? 1);
                // A setup kept together: each earlier cycle it held adds mutationRamp.
                const cycles = before.find((setup) => setup.tile === index && setup.mutationId === mutation.id)?.cycles ?? 0;
                if (!rng.chance(Math.min(1, mutation.chance * boost + cycles * config.mutationRamp))) {
                    held.push({ tile: index, mutationId: mutation.id, cycles: cycles + 1 });
                    continue;
                }
                tile.crop = { cropId: mutation.id, stage: 0, ripeTurns: 0, held: false, rotten: false };
                const helped = [
                    pollinated ? "Hand Pollinated" : "",
                    hived ? "your Beehive" : "",
                    wasted ? "the waste beside it" : "",
                    meteorBoost > 1 ? "the Meteor Shower" : "",
                    blessed("mutation") ? "the Blessing of Change" : "",
                    cycles > 0 ? `${cycles} cycle${cycles === 1 ? "" : "s"} of keeping it set up` : "",
                ].filter(Boolean);
                result.log.push(
                    `Something strange has sprouted at ${tileName(index)}: ${mutation.name}! From ${recipeCredit(mutation)}${helped.length > 0 ? `, helped by ${helped.join(", ")}` : ""}.`,
                );
                break;
            }
            if (tile.crop) continue;
            state.setups.push(...held);
            for (const setup of held) {
                const name = ctx.mutations[setup.mutationId]?.name ?? "A mutation";
                const next = Math.round(Math.min(1, (ctx.mutations[setup.mutationId]?.chance ?? 0) * (ctx.mutationChance ?? 1) + setup.cycles * config.mutationRamp) * 100);
                result.log.push(`${name} is close at ${tileName(index)}: its setup held this cycle (${next}%+ next cycle if it holds again).`);
            }
        }
    }

    /** Maybe one new pest, drawn by the crops it likes, next to one of them. */
    /** `boost` scales the chance; `forced` (a swarm) skips the chance, the cap and the grace turns. */
    function spawnPest(sheltered: Set<number>, boost: number, forced: boolean) {
        // The Curse of Hunger brings them before their time.
        const fromTurn = blessed("pests") ? 0 : config.pests.fromTurn;
        if (!forced && (state.turn < fromTurn || state.pests.length >= config.pests.max)) return;
        // Tiles that draw a pest: a crop it likes.
        const growing = (def: PestDef) =>
            state.tiles.flatMap((tile, index) => {
                if (!tile.owned || occupied(tile)) return [];
                return tile.crop && !tile.crop.rotten && def.likes.includes(tile.crop.cropId) ? [index] : [];
            });
        const draws = Object.values(ctx.pests)
            .filter((def) => def.weight > 0)
            .map((def) => ({ def, tiles: growing(def) }))
            .filter((draw) => draw.tiles.length > 0);
        const liked = draws.reduce((sum, draw) => sum + draw.tiles.length, 0);
        if (liked === 0) return;
        if (!forced && !rng.chance(Math.min(config.pests.maxChance, config.pests.chancePerCrop * liked * boost * Math.max(0, ctx.pestChance ?? 1)))) return;

        // A Jukebox's tune makes its pest likelier to be the one that comes.
        const tuned = (def: PestDef) =>
            structuresOf("jukebox").reduce((boost, { structure, def: jukebox }) => (structure.tune === def.id && jukebox.effect.kind === "jukebox" ? boost * jukebox.effect.boost : boost), 1);
        const weightOf = (draw: (typeof draws)[number]) => draw.def.weight * draw.tiles.length * tuned(draw.def);
        let roll = rng.next() * draws.reduce((sum, draw) => sum + weightOf(draw), 0);
        const draw = draws.find((entry) => (roll -= weightOf(entry)) < 0) ?? draws[draws.length - 1]!;
        const near = pick(rng, draw.tiles);
        const taken = new Set(state.pests.map((pest) => pest.tile));
        const open = around(state, near, 1).filter(
            (index) => !state.tiles[index]!.crop && !occupied(state.tiles[index]!) && !taken.has(index) && !sheltered.has(index),
        );
        if (open.length === 0 && sheltered.has(near)) return;
        const tile = open.length > 0 ? pick(rng, open) : near;
        newPest(draw.def, tile);
        pestNotes.push(`A ${draw.def.name} has come for the ${draw.def.likes.map((id) => crops[id]?.name ?? id).join(" and ")}.`);
    }
}
