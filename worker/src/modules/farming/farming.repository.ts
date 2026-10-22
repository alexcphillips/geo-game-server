import type { GeoFarmAction, GeoFarmView, GeoResearchRequest } from "@geo/shared";
import { CONTENT, FARMING } from "../../../../server/src/content";
import { isFarmingCardId } from "../../../../server/src/content/farming";
import { FARMING_FORTUNE_STAT, MUTATION_CHANCE_STAT, PEST_CHANCE_STAT } from "../../../../server/src/engine/engine.types";
import { randomSeed } from "../../../../server/src/engine/rng";
import { applyModifiers } from "../../../../server/src/engine/stats";
import {
    activeGlobalEvent,
    catchUp,
    FarmRuleError,
    newFarm,
    readFarm,
    refreshOrders,
    seededLookup,
    stepFarm,
    tickFarm,
    type FarmHandCard,
    type FarmState,
    type StoredFarm,
    type WeatherLookup,
} from "../../../../server/src/farming/farm";
import { AppError } from "../../../../server/src/http/AppError";
import { toFarmView, type FarmReport } from "../../../../server/src/modules/farming/geo-farming.view";
import type { Db } from "../../db/db";
import * as playerRepository from "../player/player.repository";
import type { InventoryRow } from "../player/player.types";
import { findContests, findGlobalEvent, recordHarvests } from "./farming.contests";
import { FIND_FARM, INSERT_FARM, UPDATE_FARM } from "./farming.sql.ts";

/**
 * The farm, from server/src/modules/farming/geo-farming.repository.ts. A
 * farm's whole grid is one JSON row; each function runs inside the caller's
 * transaction.
 */

/** How many of each item the player holds, for the Research Lab and structures. */
function heldItems(inventory: InventoryRow[]): Record<string, number> {
    const held: Record<string, number> = {};
    for (const row of inventory) held[row.item_id] = (held[row.item_id] ?? 0) + row.quantity;
    return held;
}

/** The player's farming hand: farming cards with charges left. */
function loadHand(db: Db, playerId: string, inventory: InventoryRow[]): FarmHandCard[] {
    const byId = new Map(inventory.map((row) => [row.id, row]));
    return playerRepository.findHand(db, playerId, "farming").flatMap((id): FarmHandCard[] => {
        const row = byId.get(id);
        const item = row ? CONTENT.items[row.item_id] : undefined;
        if (!row || item?.kind !== "card" || !isFarmingCardId(item.cardId) || (row.charges_left ?? 0) <= 0) return [];
        return [{ inventoryId: row.id, itemId: item.id, cardId: item.cardId, chargesLeft: row.charges_left ?? 0 }];
    });
}

/** The player's farming level, for what it unlocks (structures' required levels). */
const farmingLevel = (db: Db, playerId: string) => playerRepository.findSkillLevels(db, playerId).farming ?? 1;

/** The player's farming stats from their gear, talismans and global perks (the mayor's). */
function farmingStats(db: Db, playerId: string): { fortune: number; pestChance: number; mutationChance: number } {
    const modifiers = playerRepository.playerModifiers(db, playerId);
    return {
        fortune: applyModifiers(0, modifiers, FARMING_FORTUNE_STAT),
        pestChance: applyModifiers(1, modifiers, PEST_CHANCE_STAT),
        mutationChance: applyModifiers(1, modifiers, MUTATION_CHANCE_STAT),
    };
}

/** What an NPC pays for an item: sizes the Order Board's orders. */
const sellValue = (itemId: string) => CONTENT.items[itemId]?.sellValue ?? 1;
const itemName = (itemId: string) => CONTENT.items[itemId]?.name ?? itemId;

const NO_AWAY: FarmReport = { log: [], gained: [], xpGained: 0 };

/** A farm as loaded: `stored` is its row's text, so a save that changes nothing writes nothing. */
type LoadedFarm = { state: FarmState; weather: WeatherLookup; away: FarmReport; stored: string | null };

/**
 * The player's farm and its weather. Made on first look. The turns that came
 * due since the last look are played here, and what they gave saved; `away`
 * says what happened.
 */
function loadFarm(db: Db, playerId: string, now: Date): LoadedFarm {
    const row = db.one<{ state: string }>(FIND_FARM, playerId);
    if (!row) {
        const fresh = newFarm(FARMING, randomSeed(), randomSeed(), now);
        return { state: refreshOrders(fresh, FARMING, CONTENT.crops, sellValue, now), weather: seededLookup(fresh.weatherSeed, FARMING), away: NO_AWAY, stored: null };
    }
    const stored = readFarm(JSON.parse(row.state) as StoredFarm);
    const weather = seededLookup(stored.weatherSeed, FARMING);
    const { pestChance, mutationChance } = farmingStats(db, playerId);
    const played = catchUp(stored, {
        crops: CONTENT.crops,
        mutations: CONTENT.mutations,
        pests: CONTENT.pests,
        structures: CONTENT.structures,
        events: CONTENT.farmEvents,
        sellValue,
        itemName,
        config: FARMING,
        now,
        // A turn plays no cards or held items.
        hand: [],
        held: {},
        farmingLevel: farmingLevel(db, playerId),
        pestChance,
        mutationChance,
        weather,
    });
    if (played.gains.length > 0) playerRepository.grantItems(db, playerId, played.gains);
    if (played.xp > 0) playerRepository.addSkillXp(db, playerId, "farming", played.xp);
    recordHarvests(db, playerId, played.harvested, now);
    return {
        state: refreshOrders(played.state, FARMING, CONTENT.crops, sellValue, now),
        weather,
        away: { log: played.log, gained: played.gains, xpGained: played.xp },
        stored: row.state,
    };
}

/** Saves the farm, making its row the first time; writes nothing when it hasn't changed. */
function saveFarm(db: Db, playerId: string, loaded: LoadedFarm, state: FarmState) {
    const text = JSON.stringify(state);
    if (loaded.stored === null) db.run(INSERT_FARM, playerId, text, Date.now());
    else if (text !== loaded.stored) db.run(UPDATE_FARM, text, Date.now(), playerId);
}

/** What the turns played on this look did, then what the action did. */
function afterAway(away: FarmReport, report: FarmReport): FarmReport {
    const gained = away.gained.map((entry) => ({ ...entry }));
    for (const { itemId, quantity } of report.gained) {
        const existing = gained.find((entry) => entry.itemId === itemId);
        if (existing) existing.quantity += quantity;
        else gained.push({ itemId, quantity });
    }
    return { log: [...away.log, ...report.log], gained, xpGained: away.xpGained + report.xpGained };
}

/** The farm as the app sees it, with what it needs loaded fresh. `hand` overrides the stored one (a charge just spent). */
function viewOf(db: Db, playerId: string, state: FarmState, weather: WeatherLookup, report?: FarmReport, hand?: FarmHandCard[]): GeoFarmView {
    const now = new Date();
    const inventory = playerRepository.findInventory(db, playerId);
    return toFarmView(
        state,
        {
            hand: hand ?? loadHand(db, playerId, inventory),
            held: heldItems(inventory),
            weather,
            contests: findContests(db, playerId, now),
            global: findGlobalEvent(now),
            farmingLevel: farmingLevel(db, playerId),
            fortune: farmingStats(db, playerId).fortune,
        },
        report,
    );
}

/** The farm as it stands, from anywhere. Plays and saves the turns that came due. */
export function findFarm(db: Db, playerId: string): GeoFarmView {
    const loaded = loadFarm(db, playerId, new Date());
    saveFarm(db, playerId, loaded, loaded.state);
    return viewOf(db, playerId, loaded.state, loaded.weather, loaded.away);
}

/**
 * One farm action, saved with what it costs and gives: a seed planted, a
 * card's charge, coins for a tile, the harvest and its farming XP.
 */
export function actFarm(db: Db, playerId: string, action: GeoFarmAction): GeoFarmView {
    const now = new Date();
    const loaded = loadFarm(db, playerId, now);
    const inventoryBefore = playerRepository.findInventory(db, playerId);
    const hand = loadHand(db, playerId, inventoryBefore);

    let result;
    try {
        result = stepFarm(loaded.state, action, {
            crops: CONTENT.crops,
            mutations: CONTENT.mutations,
            pests: CONTENT.pests,
            structures: CONTENT.structures,
            events: CONTENT.farmEvents,
            globalEvent: activeGlobalEvent(now, FARMING, CONTENT.farmEvents),
            sellValue,
            itemName,
            held: heldItems(inventoryBefore),
            farmingLevel: farmingLevel(db, playerId),
            ...farmingStats(db, playerId),
            config: FARMING,
            now,
            hand,
            weather: loaded.weather,
        });
    } catch (error) {
        if (error instanceof FarmRuleError) throw AppError.badRequest(error.message);
        throw error;
    }

    if (result.coins > 0) {
        const [reason, reference] =
            action.type === "unlock"
                ? (["farm-tile", `tile:${action.tile}`] as const)
                : action.type === "accept-order"
                  ? (["farm-order", action.orderId] as const)
                  : (["vendor-buy", "travelling-merchant"] as const);
        playerRepository.spendCoins(db, playerId, result.coins, reason, reference);
    }
    if (result.coinsGained > 0) {
        playerRepository.addCoins(db, playerId, result.coinsGained, "farm-order", action.type === "deliver-order" ? action.orderId : "");
    }
    for (const used of result.itemsUsed) playerRepository.takeItems(db, playerId, used.itemId, used.quantity);
    if (result.cardPlayed) playerRepository.setCharges(db, playerId, result.cardPlayed.inventoryId, result.cardPlayed.chargesLeft);
    if (result.gains.length > 0) playerRepository.grantItems(db, playerId, result.gains);
    playerRepository.addSkillXp(db, playerId, "farming", result.xp);
    recordHarvests(db, playerId, result.harvested, now);
    saveFarm(db, playerId, loaded, result.state);

    const handAfter = hand.flatMap((card) =>
        card.inventoryId !== result.cardPlayed?.inventoryId
            ? [card]
            : result.cardPlayed.chargesLeft > 0
              ? [{ ...card, chargesLeft: result.cardPlayed.chargesLeft }]
              : [],
    );
    return viewOf(db, playerId, result.state, loaded.weather, afterAway(loaded.away, { log: result.log, gained: result.gains, xpGained: result.xp }), handAfter);
}

/**
 * Playtesting: the admin's own farm takes its next cycle now (after any that
 * came due), as the clock would play it. The caller audits it.
 */
export function adminNextCycle(db: Db, playerId: string): GeoFarmView {
    const now = new Date();
    const loaded = loadFarm(db, playerId, now);
    const { state, weather, away } = loaded;
    const step = tickFarm(
        state,
        {
            crops: CONTENT.crops,
            mutations: CONTENT.mutations,
            pests: CONTENT.pests,
            structures: CONTENT.structures,
            events: CONTENT.farmEvents,
            globalEvent: activeGlobalEvent(now, FARMING, CONTENT.farmEvents),
            sellValue,
            itemName,
            config: FARMING,
            now,
            // A turn plays no cards or held items.
            hand: [],
            held: {},
            farmingLevel: farmingLevel(db, playerId),
            ...farmingStats(db, playerId),
            weather,
        },
        weather(new Date(state.accruedAt).getTime()),
    );
    if (step.gains.length > 0) playerRepository.grantItems(db, playerId, step.gains);
    if (step.xp > 0) playerRepository.addSkillXp(db, playerId, "farming", step.xp);
    recordHarvests(db, playerId, step.harvested, now);
    const next = refreshOrders(step.state, FARMING, CONTENT.crops, sellValue, now);
    saveFarm(db, playerId, loaded, next);
    return viewOf(db, playerId, next, weather, afterAway(away, { log: ["Admin: skipped ahead one cycle.", ...step.log], gained: step.gains, xpGained: step.xp }));
}

/**
 * The Research Lab: the first of a mutation turned in records its recipe in
 * the journal and pays its reward, once. Works from anywhere.
 */
export function research(db: Db, playerId: string, { mutationId }: GeoResearchRequest): GeoFarmView {
    const loaded = loadFarm(db, playerId, new Date());
    const { state } = loaded;
    const mutation = CONTENT.mutations[mutationId];
    if (!mutation) throw AppError.badRequest("The Research Lab doesn't know that one");
    if (state.lab.includes(mutation.id)) throw AppError.badRequest(`${mutation.name} is already in the journal`);

    playerRepository.takeItems(db, playerId, mutation.produce, 1);
    state.lab.push(mutation.id);
    playerRepository.addCoins(db, playerId, mutation.research.coins, "research-lab", mutation.id);
    playerRepository.addSkillXp(db, playerId, "farming", mutation.research.xp);
    saveFarm(db, playerId, loaded, state);

    return viewOf(
        db,
        playerId,
        state,
        loaded.weather,
        afterAway(loaded.away, {
            log: [`The Research Lab logged ${mutation.name}: its recipe is in the journal. +${mutation.research.coins} coins.`],
            gained: [],
            xpGained: mutation.research.xp,
        }),
    );
}
