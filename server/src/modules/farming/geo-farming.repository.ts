import type { GeoFarmAction, GeoFarmView, GeoResearchRequest } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { CONTENT, FARMING } from "../../content";
import { isFarmingCardId } from "../../content/farming";
import { withTransaction, type TxQuery } from "../../db/transaction";
import { FARMING_FORTUNE_STAT, MUTATION_CHANCE_STAT, PEST_CHANCE_STAT } from "../../engine/engine.types";
import { randomSeed } from "../../engine/rng";
import { applyModifiers } from "../../engine/stats";
import {
    catchUp,
    FarmRuleError,
    activeGlobalEvent,
    newFarm,
    refreshOrders,
    seededLookup,
    stepFarm,
    tickFarm,
    readFarm,
    type FarmHandCard,
    type FarmState,
    type StoredFarm,
    type WeatherLookup,
} from "../../farming/farm";
import { playerModifiers } from "../../world/global-effects";
import * as adminRepository from "../admin/geo-admin.repository";
import * as playerRepository from "../player/geo-player.repository";
import { findContests, findGlobalEvent, recordHarvests } from "./geo-farming.contests";
import { toFarmView, type FarmReport } from "./geo-farming.view";
import { FIND_FARM_FOR_UPDATE, INSERT_FARM, UPDATE_FARM } from "./geo-farming.sql";

type InventoryRows = Awaited<ReturnType<typeof playerRepository.findInventory>>;

/** How many of each item the player holds, for the Research Lab and structures. */
function heldItems(inventory: InventoryRows): Record<string, number> {
    const held: Record<string, number> = {};
    for (const row of inventory) held[row.item_id] = (held[row.item_id] ?? 0) + row.quantity;
    return held;
}

/** The player's farming hand: farming cards with charges left. */
async function loadHand(tx: TxQuery, playerId: string, inventory: InventoryRows): Promise<FarmHandCard[]> {
    const handIds = await playerRepository.findHand(playerId, "farming", tx);
    const byId = new Map(inventory.map((row) => [row.id, row]));
    return handIds.flatMap((id): FarmHandCard[] => {
        const row = byId.get(id);
        const item = row ? CONTENT.items[row.item_id] : undefined;
        if (!row || item?.kind !== "card" || !isFarmingCardId(item.cardId) || (row.charges_left ?? 0) <= 0) return [];
        return [{ inventoryId: row.id, itemId: item.id, cardId: item.cardId, chargesLeft: row.charges_left ?? 0 }];
    });
}

/** The player's farming level, for what it unlocks (structures' required levels). */
async function farmingLevel(tx: TxQuery, playerId: string): Promise<number> {
    return (await playerRepository.findSkillLevels(tx, playerId)).farming ?? 1;
}

/** The player's farming stats from their gear, talismans and global perks (the mayor's). */
async function farmingStats(tx: TxQuery, playerId: string): Promise<{ fortune: number; pestChance: number; mutationChance: number }> {
    const modifiers = await playerModifiers(playerId, tx);
    return {
        fortune: applyModifiers(0, modifiers, FARMING_FORTUNE_STAT),
        pestChance: applyModifiers(1, modifiers, PEST_CHANCE_STAT),
        mutationChance: applyModifiers(1, modifiers, MUTATION_CHANCE_STAT),
    };
}

/** What an NPC pays for an item: sizes the Order Board's orders. */
const sellValue = (itemId: string) => CONTENT.items[itemId]?.sellValue ?? 1;
const itemName = (itemId: string) => CONTENT.items[itemId]?.name ?? itemId;

type LoadedFarm = { state: FarmState; weather: WeatherLookup; away: FarmReport };

/**
 * The player's farm, locked for this transaction, and its weather. Made on
 * first look. The turns that came due since the last look are played here,
 * and what they gave saved; `away` says what happened.
 */
async function loadFarm(tx: TxQuery, playerId: string, now: Date): Promise<LoadedFarm> {
    const [row] = await tx<{ state: StoredFarm }>(FIND_FARM_FOR_UPDATE, [playerId]);
    let stored = row ? readFarm(row.state) : null;
    if (!stored) {
        const fresh = newFarm(FARMING, randomSeed(), randomSeed(), now);
        const [inserted] = await tx<{ state: FarmState }>(INSERT_FARM, [playerId, fresh]);
        if (inserted) {
            return { state: refreshOrders(fresh, FARMING, CONTENT.crops, sellValue, now), weather: seededLookup(fresh.weatherSeed, FARMING), away: NO_AWAY };
        }
        // Made by a request racing this one: read theirs.
        const [raced] = await tx<{ state: StoredFarm }>(FIND_FARM_FOR_UPDATE, [playerId]);
        if (!raced) throw new Error("Farm insert raced and vanished");
        stored = readFarm(raced.state);
    }
    const weather = seededLookup(stored.weatherSeed, FARMING);
    const { pestChance, mutationChance } = await farmingStats(tx, playerId);
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
        farmingLevel: await farmingLevel(tx, playerId),
        pestChance,
        mutationChance,
        weather,
    });
    if (played.gains.length > 0) await playerRepository.grantItems(tx, playerId, played.gains);
    if (played.xp > 0) await playerRepository.addSkillXp(tx, playerId, "farming", played.xp);
    await recordHarvests(tx, playerId, played.harvested, now);
    return {
        state: refreshOrders(played.state, FARMING, CONTENT.crops, sellValue, now),
        weather,
        away: { log: played.log, gained: played.gains, xpGained: played.xp },
    };
}

const NO_AWAY: FarmReport = { log: [], gained: [], xpGained: 0 };

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
async function viewOf(tx: TxQuery, playerId: string, state: FarmState, weather: WeatherLookup, report?: FarmReport, hand?: FarmHandCard[]): Promise<GeoFarmView> {
    const now = new Date();
    const inventory = await playerRepository.findInventory(playerId, tx);
    return toFarmView(
        state,
        {
            hand: hand ?? (await loadHand(tx, playerId, inventory)),
            held: heldItems(inventory),
            weather,
            contests: await findContests(tx, playerId, now),
            global: findGlobalEvent(now),
            farmingLevel: await farmingLevel(tx, playerId),
            fortune: (await farmingStats(tx, playerId)).fortune,
        },
        report,
    );
}

/** The farm as it stands, from anywhere. Plays and saves the turns that came due. */
export async function findFarm(playerId: string): Promise<GeoFarmView> {
    return withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        const { state, weather, away } = await loadFarm(tx, playerId, new Date());
        await tx(UPDATE_FARM, [playerId, state]);
        return viewOf(tx, playerId, state, weather, away);
    });
}

/**
 * One farm action, saved with what it costs and gives in one transaction:
 * a seed planted, a card's charge, coins for a tile, the harvest and
 * its farming XP.
 */
export async function actFarm(playerId: string, action: GeoFarmAction): Promise<GeoFarmView> {
    return withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        const now = new Date();
        const { state, weather, away } = await loadFarm(tx, playerId, now);
        const inventoryBefore = await playerRepository.findInventory(playerId, tx);
        const hand = await loadHand(tx, playerId, inventoryBefore);

        let result;
        try {
            result = stepFarm(state, action, {
                crops: CONTENT.crops,
                mutations: CONTENT.mutations,
                pests: CONTENT.pests,
                structures: CONTENT.structures,
                events: CONTENT.farmEvents,
                globalEvent: activeGlobalEvent(now, FARMING, CONTENT.farmEvents),
                sellValue,
                itemName,
                held: heldItems(inventoryBefore),
                farmingLevel: await farmingLevel(tx, playerId),
                ...(await farmingStats(tx, playerId)),
                config: FARMING,
                now,
                hand,
                weather,
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
            await playerRepository.spendCoins(tx, playerId, result.coins, reason, reference);
        }
        if (result.coinsGained > 0) {
            await playerRepository.addCoins(tx, playerId, result.coinsGained, "farm-order", action.type === "deliver-order" ? action.orderId : "");
        }
        for (const used of result.itemsUsed) await playerRepository.takeItems(tx, playerId, used.itemId, used.quantity);
        if (result.cardPlayed) await playerRepository.setCharges(tx, playerId, result.cardPlayed.inventoryId, result.cardPlayed.chargesLeft);
        if (result.gains.length > 0) await playerRepository.grantItems(tx, playerId, result.gains);
        await playerRepository.addSkillXp(tx, playerId, "farming", result.xp);
        await recordHarvests(tx, playerId, result.harvested, now);
        await tx(UPDATE_FARM, [playerId, result.state]);

        const handAfter = hand.flatMap((card) =>
            card.inventoryId !== result.cardPlayed?.inventoryId
                ? [card]
                : result.cardPlayed.chargesLeft > 0
                  ? [{ ...card, chargesLeft: result.cardPlayed.chargesLeft }]
                  : [],
        );
        return viewOf(tx, playerId, result.state, weather, afterAway(away, { log: result.log, gained: result.gains, xpGained: result.xp }), handAfter);
    });
}

/**
 * Playtesting: an admin's farm takes its next cycle now, with the weather
 * forecast for it. The real clock is left alone, so the cycle due next still
 * comes when it would have (with that same weather). Audited.
 */
export async function adminNextCycle(playerId: string): Promise<GeoFarmView> {
    return withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        const now = new Date();
        const { state, weather, away } = await loadFarm(tx, playerId, now);
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
                farmingLevel: await farmingLevel(tx, playerId),
                ...(await farmingStats(tx, playerId)),
                weather,
            },
            weather(new Date(state.accruedAt).getTime()),
        );
        if (step.gains.length > 0) await playerRepository.grantItems(tx, playerId, step.gains);
        if (step.xp > 0) await playerRepository.addSkillXp(tx, playerId, "farming", step.xp);
        await recordHarvests(tx, playerId, step.harvested, now);
        const next = refreshOrders(step.state, FARMING, CONTENT.crops, sellValue, now);
        await tx(UPDATE_FARM, [playerId, next]);
        await adminRepository.audit(tx, playerId, "farm-next-cycle", playerId, { turn: next.turn });
        return viewOf(tx, playerId, next, weather, afterAway(away, { log: ["Admin: skipped ahead one cycle.", ...step.log], gained: step.gains, xpGained: step.xp }));
    });
}

/**
 * The Research Lab: the first of a mutation turned in records its recipe in
 * the journal and pays its reward, once. Works from anywhere.
 */
export async function research(playerId: string, { mutationId }: GeoResearchRequest): Promise<GeoFarmView> {
    return withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        const { state, weather, away } = await loadFarm(tx, playerId, new Date());
        const mutation = CONTENT.mutations[mutationId];
        if (!mutation) throw AppError.badRequest("The Research Lab doesn't know that one");
        if (state.lab.includes(mutation.id)) throw AppError.badRequest(`${mutation.name} is already in the journal`);

        await playerRepository.takeItems(tx, playerId, mutation.produce, 1);
        state.lab.push(mutation.id);
        await playerRepository.addCoins(tx, playerId, mutation.research.coins, "research-lab", mutation.id);
        await playerRepository.addSkillXp(tx, playerId, "farming", mutation.research.xp);
        await tx(UPDATE_FARM, [playerId, state]);

        return viewOf(
            tx,
            playerId,
            state,
            weather,
            afterAway(away, {
                log: [`The Research Lab logged ${mutation.name}: its recipe is in the journal. +${mutation.research.coins} coins.`],
                gained: [],
                xpGained: mutation.research.xp,
            }),
        );
    });
}
