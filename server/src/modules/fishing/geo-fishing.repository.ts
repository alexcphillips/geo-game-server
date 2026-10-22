import type { GeoFishingAction, GeoFishingRunView, GeoFishingTier } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { CHUM_BAIT_IDS, CONTENT } from "../../content";
import { fishItemId, isFishingCardId, qualityFishItemId, type RodDef } from "../../content/fishing";
import { withTransaction, type TxQuery } from "../../db/transaction";
import { randomSeed } from "../../engine/rng";
import { fishingOdds } from "../../fishing/fishing";
import {
    FishingRuleError,
    newFishingState,
    stepFishing,
    type CastBait,
    type FishingHandCard,
    type FishingSetup,
    type FishingState,
} from "../../fishing/fishing-run";
import { playerModifiers } from "../../world/global-effects";
import * as dungeonFights from "../dungeon-runs/geo-dungeon-runs.fights";
import * as playerRepository from "../player/geo-player.repository";
import * as wardrobeRepository from "../wardrobe/geo-wardrobe.repository";
import { ABANDON_AFTER_MINUTES, openCombatRun } from "../runs/geo-runs.repository";
import { ABANDON_STALE_RUNS, FIND_ACTIVE_RUN, FIND_RUN_FOR_UPDATE, INSERT_RUN, UPDATE_RUN } from "../runs/geo-runs.sql";
import { toFishingView } from "./geo-fishing.view";

/** The admin testing switch, honoured only while the player is still an admin. */
const ALWAYS_SEA_CREATURES = `
  SELECT always_sea_creatures AND role = 'admin' AS always FROM geo.players WHERE id = $1;
`;

/** A fishing Run's row in geo.runs: same table as combat, its own state. */
type FishingRunRow = {
    id: string;
    player_id: string;
    kind: string;
    status: string;
    state: FishingState;
};

/** The player's fishing hand, as the Run plays it: fishing cards with charges left. */
async function loadHand(tx: TxQuery, playerId: string): Promise<FishingHandCard[]> {
    const handIds = await playerRepository.findHand(playerId, "fishing", tx);
    const inventory = await playerRepository.findInventory(playerId, tx);
    const byId = new Map(inventory.map((row) => [row.id, row]));
    return handIds.flatMap((id): FishingHandCard[] => {
        const row = byId.get(id);
        const item = row ? CONTENT.items[row.item_id] : undefined;
        if (!row || item?.kind !== "card" || !isFishingCardId(item.cardId) || (row.charges_left ?? 0) <= 0) return [];
        return [{ inventoryId: row.id, itemId: item.id, cardId: item.cardId, chargesLeft: row.charges_left ?? 0 }];
    });
}

/** The rod in the player's main hand. Refused without one: you can't fish without a rod. */
async function loadRod(tx: TxQuery, playerId: string): Promise<RodDef> {
    const slot = (await playerRepository.findEquipment(playerId, tx)).find((row) => row.slot === "mainHand");
    const [row] = slot ? await playerRepository.findInventoryByIds(playerId, [slot.inventory_id], tx) : [];
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
async function loadSetup(tx: TxQuery, playerId: string): Promise<FishingSetup> {
    const rod = await loadRod(tx, playerId);
    const fishingLevel = (await playerRepository.findSkillLevels(tx, playerId)).fishing ?? 1;
    const odds = fishingOdds(await playerModifiers(playerId, tx));
    const [testing] = await tx<{ always: boolean }>(ALWAYS_SEA_CREATURES, [playerId]);
    return {
        rod,
        power: rod.power + fishingLevel,
        seaCreatureChance: testing?.always ? 1 : odds.seaCreatureChance,
        fish: CONTENT.fish,
    };
}

/**
 * Opens a fishing Run at water of `tier`, or resumes the one already open.
 * Refused mid-fight, or with no fishing cards in hand.
 */
export async function startFishing(playerId: string, tier: GeoFishingTier): Promise<GeoFishingRunView> {
    return withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        await tx(ABANDON_STALE_RUNS, [playerId, ABANDON_AFTER_MINUTES]);
        const [active] = await tx<FishingRunRow>(FIND_ACTIVE_RUN, [playerId]);
        if (active && active.kind !== "fishing") throw AppError.badRequest("You're in a fight. Finish or flee it first.");
        if (!active) await dungeonFights.assertNotInDungeon(tx, playerId);
        // Before the rod is read: auto-swap puts on the fishing loadout, a
        // Run being resumed included (say, combat gear worn since).
        await wardrobeRepository.autoSwap(tx, playerId, { activity: "fishing" });
        const setup = await loadSetup(tx, playerId);
        if (active) return toFishingView(active.id, active.state, setup);

        const hand = await loadHand(tx, playerId);
        if (hand.length === 0) {
            throw AppError.badRequest("Your fishing hand is empty. The Angler sells fishing cards.");
        }
        const state = newFishingState(tier, hand, randomSeed());
        const [row] = await tx<FishingRunRow>(INSERT_RUN, [playerId, "fishing", [], null, state, false, null, null, null]);
        if (!row) throw new Error("Run insert returned nothing");
        return toFishingView(row.id, state, setup);
    });
}

/**
 * One step: cast, wait, strike, a card… Saved with what it costs and gives
 * in one transaction: bait off the hook, card charges, and a landed fish into
 * the inventory with its fishing XP. Fighting a sea creature leaves the spot
 * and starts its combat Run; if that's refused (say, an empty combat hand),
 * nothing changes and the creature is still on the line.
 */
export async function actFishing(playerId: string, runId: string, action: GeoFishingAction): Promise<GeoFishingRunView> {
    return withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        await tx(ABANDON_STALE_RUNS, [playerId, ABANDON_AFTER_MINUTES]);
        const row = await findOpenRun(tx, playerId, runId);
        // Gear changed mid-Run: auto-swap puts the fishing loadout back on.
        await wardrobeRepository.autoSwap(tx, playerId, { activity: "fishing" });
        const setup = await loadSetup(tx, playerId);

        // A cast takes the first packed bait, unless a perk saves it. None
        // packed: a bare hook (commons only, see CastBait).
        let bait: CastBait = null;
        let baitSlot: { slot: number; itemId: string; from: number } | null = null;
        if (action.type === "cast") {
            const packed = (await playerRepository.findBait(playerId, tx)).contents
                .filter((entry) => entry.quantity > 0 && CONTENT.items[entry.itemId])
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
            const odds = fishingOdds(await playerModifiers(playerId, tx));
            if (!(Math.random() < odds.baitSaveChance)) await playerRepository.useBait(tx, playerId, baitSlot);
        }

        for (const card of after.hand) {
            const previous = row.state.hand.find((entry) => entry.inventoryId === card.inventoryId);
            if (previous && previous.chargesLeft !== card.chargesLeft) {
                await playerRepository.setCharges(tx, playerId, card.inventoryId, card.chargesLeft);
            }
        }

        // The cast just ended with a catch: into the inventory, with its XP.
        const landed = after.phase === "over" && row.state.phase !== "over" ? after.result : null;
        if (landed?.kind === "landed") {
            const fish = CONTENT.fish[landed.fishId];
            if (!fish) throw new Error(`Unknown fish "${landed.fishId}"`);
            const itemId = landed.tier ? qualityFishItemId(fish.id, landed.tier) : fishItemId(fish.id);
            await playerRepository.grantItems(tx, playerId, [{ itemId, quantity: 1 }]);
            await playerRepository.addSkillXp(tx, playerId, "fishing", fish.xp);
        }

        if (landed?.kind === "creature") {
            await tx(UPDATE_RUN, [row.id, after, "left", null, null]);
            await openCombatRun(tx, playerId, { enemyId: landed.enemyId, spawnId: null });
            return toFishingView(row.id, after, setup);
        }

        await tx(UPDATE_RUN, [row.id, after, "active", null, null]);
        return toFishingView(row.id, after, setup);
    });
}

/** Leaves the spot: the Run ends, and the fishing hand is free to change again. */
export async function leaveFishing(playerId: string, runId: string): Promise<void> {
    await withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        const row = await findOpenRun(tx, playerId, runId);
        await tx(UPDATE_RUN, [row.id, row.state, "left", null, null]);
    });
}

/**
 * Ends an open fishing Run, e.g. walking off to start a fight. The caller
 * holds the player lock.
 */
export async function endOpenFishing(tx: TxQuery, row: { id: string; kind: string; state: unknown }) {
    if (row.kind === "fishing") await tx(UPDATE_RUN, [row.id, row.state, "left", null, null]);
}

async function findOpenRun(tx: TxQuery, playerId: string, runId: string): Promise<FishingRunRow> {
    const [row] = await tx<FishingRunRow>(FIND_RUN_FOR_UPDATE, [runId, playerId]);
    if (!row || row.kind !== "fishing") throw AppError.notFound("Fishing Run not found");
    if (row.status !== "active") throw AppError.badRequest("You've left that spot");
    return row;
}
