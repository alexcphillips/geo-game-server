import type { GeoFishingAction, GeoFishingRunView, GeoFishingTier } from "@geo/shared";
import { CHUM_BAIT_IDS, CONTENT } from "../../../../server/src/content";
import { fishItemId, isFishingCardId, qualityFishItemId, type RodDef } from "../../../../server/src/content/fishing";
import { randomSeed } from "../../../../server/src/engine/rng";
import { fishingOdds } from "../../../../server/src/fishing/fishing";
import {
    FishingRuleError,
    newFishingState,
    stepFishing,
    type CastBait,
    type FishingHandCard,
    type FishingSetup,
    type FishingState,
} from "../../../../server/src/fishing/fishing-run";
import { AppError } from "../../../../server/src/http/AppError";
import { toFishingView } from "../../../../server/src/modules/fishing/geo-fishing.view";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import { assertNotInDungeon } from "../dungeon-runs/dungeon-runs.fights";
import * as playerRepository from "../player/player.repository";
import { endStaleRun, findLiveRun, openCombatRun } from "../runs/runs.repository";
import { FIND_RUN, INSERT_RUN, UPDATE_RUN, UPDATE_RUN_STATE } from "../runs/runs.sql.ts";
import type { RunRecord } from "../runs/runs.types";
import { autoSwap } from "../wardrobe/wardrobe.repository";
import { ALWAYS_SEA_CREATURES } from "./fishing.sql.ts";

/**
 * Fishing Runs, from server/src/modules/fishing/geo-fishing.repository.ts.
 * They share the `runs` table with combat, with their own state. Each
 * function runs inside the caller's transaction.
 */

type FishingRunRow = { id: string; status: string; state: FishingState };

/** The player's fishing hand, as the Run plays it: fishing cards with charges left. */
function loadHand(db: Db, playerId: string): FishingHandCard[] {
    const byId = new Map(playerRepository.findInventory(db, playerId).map((row) => [row.id, row]));
    return playerRepository.findHand(db, playerId, "fishing").flatMap((id): FishingHandCard[] => {
        const row = byId.get(id);
        const item = row ? CONTENT.items[row.item_id] : undefined;
        if (!row || item?.kind !== "card" || !isFishingCardId(item.cardId) || (row.charges_left ?? 0) <= 0) return [];
        return [{ inventoryId: row.id, itemId: item.id, cardId: item.cardId, chargesLeft: row.charges_left ?? 0 }];
    });
}

/** The rod in the player's main hand. Refused without one: you can't fish without a rod. */
function loadRod(db: Db, playerId: string): RodDef {
    const slot = playerRepository.findEquipment(db, playerId).find((row) => row.slot === "mainHand");
    const row = slot ? playerRepository.findInventoryRow(db, playerId, slot.inventory_id) : null;
    const item = row ? CONTENT.items[row.item_id] : undefined;
    if (item?.kind !== "equipment" || !item.rod) {
        throw AppError.badRequest("Hold a fishing rod in your main hand: save a loadout with one in the Wardrobe and it's worn when you fish. The Angler sells rods.");
    }
    return { name: item.name, ...item.rod };
}

/**
 * Rod, Fishing Power and odds, from the equipped rod, the player's level and
 * every modifier they have. An admin's testing switch makes every bite a sea
 * creature.
 */
function loadSetup(db: Db, playerId: string): FishingSetup {
    const rod = loadRod(db, playerId);
    const fishingLevel = playerRepository.findSkillLevels(db, playerId).fishing ?? 1;
    const odds = fishingOdds(playerRepository.playerModifiers(db, playerId));
    const testing = db.one<{ always: number }>(ALWAYS_SEA_CREATURES, playerId);
    return { rod, power: rod.power + fishingLevel, seaCreatureChance: testing?.always ? 1 : odds.seaCreatureChance, fish: CONTENT.fish };
}

/** Saves a step; `status` only when it ends the Run (setting it rewrites an index entry). */
const saveRun = (db: Db, id: string, state: FishingState, status: "active" | "left") =>
    status === "active"
        ? db.run(UPDATE_RUN_STATE, JSON.stringify(state), Date.now(), id)
        : db.run(UPDATE_RUN, id, JSON.stringify(state), status, null, null, Date.now());

/**
 * Opens a fishing Run at water of `tier`, or resumes the one already open.
 * Refused mid-fight, or with no fishing cards in hand.
 */
export function startFishing(world: World, playerId: string, tier: GeoFishingTier): GeoFishingRunView {
    const { db } = world;
    const active = findLiveRun(db, playerId);
    if (active && active.kind !== "fishing") throw AppError.badRequest("You're in a fight. Finish or flee it first.");
    if (!active) assertNotInDungeon(db, playerId);
    // Before the rod is read: auto-swap puts on the fishing loadout, a Run
    // being resumed included (say, combat gear worn since).
    autoSwap(db, playerId, { activity: "fishing" });
    const setup = loadSetup(db, playerId);
    if (active) return toFishingView(active.id, JSON.parse(active.state) as FishingState, setup);

    const hand = loadHand(db, playerId);
    if (hand.length === 0) throw AppError.badRequest("Your fishing hand is empty. The Angler sells fishing cards.");
    const state = newFishingState(tier, hand, randomSeed());
    const id = crypto.randomUUID();
    db.run(INSERT_RUN, id, playerId, "fishing", "[]", null, JSON.stringify(state), 0, null, null, null, null, null, Date.now());
    return toFishingView(id, state, setup);
}

/**
 * One step: cast, wait, strike, a card… Saved with what it costs and gives
 * in one transaction: bait off the hook, card charges, and a landed fish into
 * the inventory with its fishing XP. Fighting a sea creature leaves the spot
 * and starts its combat Run; if that's refused (say, an empty combat hand),
 * nothing changes and the creature is still on the line.
 */
export function actFishing(world: World, playerId: string, runId: string, action: GeoFishingAction): GeoFishingRunView {
    const { db } = world;
    endStaleRun(db, playerId);
    const row = findOpenRun(db, playerId, runId);
    // Gear changed mid-Run: auto-swap puts the fishing loadout back on.
    autoSwap(db, playerId, { activity: "fishing" });
    const setup = loadSetup(db, playerId);

    // A cast takes the first packed bait, unless a perk saves it. None
    // packed: a bare hook (commons only, see CastBait).
    let bait: CastBait = null;
    let baitSlot: { slot: number; itemId: string; from: number } | null = null;
    if (action.type === "cast") {
        const packed = playerRepository
            .findBait(db, playerId)
            .contents.filter((entry) => entry.quantity > 0 && CONTENT.items[entry.itemId])
            .sort((a, b) => a.slot - b.slot)[0];
        if (packed) {
            bait = { itemId: packed.itemId, chum: CHUM_BAIT_IDS.has(packed.itemId) };
            baitSlot = { slot: packed.slot, itemId: packed.itemId, from: packed.quantity };
        }
    }

    let after: FishingState;
    try {
        after = stepFishing(row.state, action, setup, bait);
    } catch (error) {
        if (error instanceof FishingRuleError) throw AppError.badRequest(error.message);
        throw error;
    }

    if (baitSlot) {
        const odds = fishingOdds(playerRepository.playerModifiers(db, playerId));
        if (!(Math.random() < odds.baitSaveChance)) playerRepository.useBait(db, playerId, baitSlot);
    }

    for (const card of after.hand) {
        const previous = row.state.hand.find((entry) => entry.inventoryId === card.inventoryId);
        if (previous && previous.chargesLeft !== card.chargesLeft) {
            playerRepository.setCharges(db, playerId, card.inventoryId, card.chargesLeft);
        }
    }

    // The cast just ended with a catch: into the inventory, with its XP.
    const landed = after.phase === "over" && row.state.phase !== "over" ? after.result : null;
    if (landed?.kind === "landed") {
        const fish = CONTENT.fish[landed.fishId];
        if (!fish) throw new Error(`Unknown fish "${landed.fishId}"`);
        const itemId = landed.tier ? qualityFishItemId(fish.id, landed.tier) : fishItemId(fish.id);
        playerRepository.grantItems(db, playerId, [{ itemId, quantity: 1 }]);
        playerRepository.addSkillXp(db, playerId, "fishing", fish.xp);
    }

    if (landed?.kind === "creature") {
        saveRun(db, row.id, after, "left");
        openCombatRun(world, playerId, { enemyId: landed.enemyId, spawnId: null });
        return toFishingView(row.id, after, setup);
    }

    saveRun(db, row.id, after, "active");
    return toFishingView(row.id, after, setup);
}

/** Leaves the spot: the Run ends, and the fishing hand is free to change again. */
export function leaveFishing(world: World, playerId: string, runId: string) {
    const row = findOpenRun(world.db, playerId, runId);
    saveRun(world.db, row.id, row.state, "left");
}

/** Ends an open fishing Run, e.g. walking off to start a fight. */
export function endOpenFishing(db: Db, row: Pick<RunRecord, "id" | "kind" | "state">) {
    if (row.kind === "fishing") db.run(UPDATE_RUN, row.id, row.state, "left", null, null, Date.now());
}

function findOpenRun(db: Db, playerId: string, runId: string): FishingRunRow {
    const record = db.one<RunRecord>(FIND_RUN, runId, playerId);
    if (!record || record.kind !== "fishing") throw AppError.notFound("Fishing Run not found");
    if (record.status !== "active") throw AppError.badRequest("You've left that spot");
    return { id: record.id, status: record.status, state: JSON.parse(record.state) as FishingState };
}
