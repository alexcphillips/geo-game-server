import {
    GEO_EQUIPMENT_SLOTS,
    geoSkillLevel,
    geoSlotKind,
    geoUnmetSkill,
    type GeoEquipmentSlot,
    type GeoLoadout,
    type GeoLoadoutActivity,
    type GeoWardrobe,
} from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import { CONTENT, GAME_CONFIG } from "../../content";
import type { TxQuery } from "../../db/transaction";
import { CLEAR_ACTIVE_PET, FIND_SKILL_XP, SET_ACTIVE_PET, UNEQUIP_INVENTORY, UPSERT_EQUIPMENT } from "../player/geo-player.sql";
import type { SkillXpRow } from "../player/geo-player.types";
import {
    ADD_BOUGHT_SLOT,
    CLEAR_AUTO_FOR,
    CLEAR_EQUIPMENT,
    DELETE_LOADOUT,
    FIND_LOADOUT,
    FIND_LOADOUTS,
    FIND_MAIN_HAND_ITEM,
    FIND_OWNED,
    FIND_WARDROBE_STATE,
    INSERT_LOADOUT,
    RENAME_LOADOUT,
    SAVE_WORN,
    SET_ACTIVE,
    SET_AUTO_FOR,
    SYNC_ACTIVE,
} from "./geo-wardrobe.sql";

/**
 * The wardrobe's storage. No player-repository import: `findMe` reads the
 * wardrobe from here, and the equipment and pet writes share its SQL.
 * Coins for upgrades are spent by the controller.
 */

const db: TxQuery = query;

type WardrobeStateRow = { wardrobe_bought: number; active_loadout: number | null };
type LoadoutRow = {
    slot: number;
    name: string;
    equipment: Record<string, string>;
    pet_id: string | null;
    auto_for: GeoLoadoutActivity | null;
};
type OwnedRow = { id: string; item_id: string };

const referencedIds = (rows: LoadoutRow[]) =>
    [...new Set(rows.flatMap((row) => [...Object.values(row.equipment), ...(row.pet_id ? [row.pet_id] : [])]))];

async function findOwned(tx: TxQuery, playerId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx<OwnedRow>(FIND_OWNED, [playerId, ids]);
    return new Map(rows.map((row) => [row.id, row.item_id]));
}

/** Slots owned now: the config's start plus those bought. */
export function slotCount(bought: number): number {
    return Math.min(GAME_CONFIG.wardrobe.startingSlots + bought, GAME_CONFIG.wardrobe.maxSlots);
}

/** Coins for the next slot, or null at the max. */
export function nextSlotCost(bought: number): number | null {
    const { maxSlots, slotCost } = GAME_CONFIG.wardrobe;
    return slotCount(bought) >= maxSlots ? null : slotCost.first + slotCost.step * bought;
}

async function findState(tx: TxQuery, playerId: string): Promise<WardrobeStateRow> {
    const [row] = await tx<WardrobeStateRow>(FIND_WARDROBE_STATE, [playerId]);
    if (!row) throw AppError.notFound("Player not found");
    return row;
}

/** The wardrobe as the app sees it: references to items no longer owned are left out. */
export async function findWardrobe(playerId: string, tx: TxQuery = db): Promise<GeoWardrobe> {
    const [state, rows] = await Promise.all([findState(tx, playerId), tx<LoadoutRow>(FIND_LOADOUTS, [playerId])]);
    const owned = await findOwned(tx, playerId, referencedIds(rows));
    const slots = slotCount(state.wardrobe_bought);

    const loadouts = rows
        .filter((row) => row.slot < slots)
        .map(
            (row): GeoLoadout => ({
                slot: row.slot,
                name: row.name,
                equipment: Object.fromEntries(
                    Object.entries(row.equipment).filter(([, id]) => owned.has(id)),
                ) as Partial<Record<GeoEquipmentSlot, string>>,
                petId: row.pet_id && owned.has(row.pet_id) ? row.pet_id : null,
                autoFor: row.auto_for,
            }),
        );

    return {
        slots,
        maxSlots: GAME_CONFIG.wardrobe.maxSlots,
        loadouts,
        activeSlot: state.active_loadout,
        nextSlotCost: nextSlotCost(state.wardrobe_bought),
    };
}

/** Refuses a slot number the player doesn't have. */
export async function assertSlotOwned(tx: TxQuery, playerId: string, slot: number) {
    const state = await findState(tx, playerId);
    if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount(state.wardrobe_bought)) {
        throw AppError.badRequest("You don't have that loadout slot");
    }
}

/** Stores what's worn in the slot under `name`, and makes it the active loadout. */
export async function saveWorn(tx: TxQuery, playerId: string, slot: number, name: string) {
    await tx(SAVE_WORN, [playerId, slot, name]);
}

/** A loadout built elsewhere (the starter kit): slot → inventory id. */
export async function insertLoadout(
    tx: TxQuery,
    playerId: string,
    slot: number,
    name: string,
    equipment: Partial<Record<GeoEquipmentSlot, string>>,
    petId: string | null,
    autoFor: GeoLoadoutActivity | null,
) {
    await tx(INSERT_LOADOUT, [playerId, slot, name, JSON.stringify(equipment), petId, autoFor]);
}

export async function renameLoadout(tx: TxQuery, playerId: string, slot: number, name: string) {
    const [row] = await tx<{ slot: number }>(RENAME_LOADOUT, [playerId, slot, name]);
    if (!row) throw AppError.notFound("Nothing saved in that loadout slot");
}

export async function deleteLoadout(tx: TxQuery, playerId: string, slot: number) {
    await tx(DELETE_LOADOUT, [playerId, slot]);
}

/** After any change to worn gear or the pet: the active loadout follows it. */
export async function syncActiveLoadout(tx: TxQuery, playerId: string) {
    await tx(SYNC_ACTIVE, [playerId]);
}

/**
 * Wears a saved loadout: everything worn comes off, then each of its items
 * that's still owned, still fits and whose skill levels the player has goes
 * on, and its pet comes out (or none). Anything else is skipped, not
 * refused. The caller checks the player isn't mid-Run (or is starting one).
 */
export async function wearLoadout(tx: TxQuery, playerId: string, slot: number) {
    const [row] = await tx<LoadoutRow>(FIND_LOADOUT, [playerId, slot]);
    if (!row) throw AppError.notFound("Nothing saved in that loadout slot");
    const owned = await findOwned(tx, playerId, referencedIds([row]));
    const xp = await tx<SkillXpRow>(FIND_SKILL_XP, [playerId]);
    const levels = Object.fromEntries(xp.map((entry) => [entry.skill, geoSkillLevel(Number(entry.xp))]));

    await tx(CLEAR_EQUIPMENT, [playerId]);
    for (const [equipSlot, inventoryId] of Object.entries(row.equipment)) {
        if (!GEO_EQUIPMENT_SLOTS.includes(equipSlot as GeoEquipmentSlot)) continue;
        const item = CONTENT.items[owned.get(inventoryId) ?? ""];
        if (item?.kind !== "equipment" || item.slot !== geoSlotKind(equipSlot as GeoEquipmentSlot)) continue;
        if (geoUnmetSkill(levels, item.skills)) continue;
        await tx(UNEQUIP_INVENTORY, [playerId, inventoryId]);
        await tx(UPSERT_EQUIPMENT, [playerId, equipSlot, inventoryId]);
    }

    const pet = row.pet_id ? CONTENT.items[owned.get(row.pet_id) ?? ""] : undefined;
    if (row.pet_id && pet?.kind === "pet") await tx(SET_ACTIVE_PET, [playerId, row.pet_id]);
    else await tx(CLEAR_ACTIVE_PET, [playerId]);

    await tx(SET_ACTIVE, [playerId, slot]);
}

/**
 * What's starting, for auto-swap to pick a loadout by. It carries what a
 * player-set rule could match on later ("entering this dungeon", "fighting
 * this creature"); for now only the activity decides.
 */
export type LoadoutTrigger =
    | { activity: "fishing" }
    | { activity: "combat"; enemyId: string; dungeonId: string | null };

const isRod = (itemId: string | undefined) => {
    const item = itemId ? CONTENT.items[itemId] : undefined;
    return item?.kind === "equipment" && !!item.rod;
};

/**
 * As an activity starts (a fight, a fishing Run or a step in one): wears the
 * loadout auto-swap picks for it, if it isn't already worn. In the Run's own
 * transaction, before the player's gear is read. Returns whether it swapped.
 */
export async function autoSwap(tx: TxQuery, playerId: string, trigger: LoadoutTrigger): Promise<boolean> {
    const state = await findState(tx, playerId);
    const target = await pickAutoLoadout(tx, playerId, state, trigger);
    if (target === null || target === state.active_loadout) return false;
    await wearLoadout(tx, playerId, target);
    return true;
}

/**
 * The loadout slot auto-swap wears for a trigger, or null to leave gear be.
 * The one place that decides, so player-set rules go here, ahead of the
 * activity tags.
 */
async function pickAutoLoadout(tx: TxQuery, playerId: string, state: WardrobeStateRow, trigger: LoadoutTrigger): Promise<number | null> {
    const { activity } = trigger;
    // A slot no longer owned (fewer starting slots in config) isn't worn.
    const loadouts = (await tx<LoadoutRow>(FIND_LOADOUTS, [playerId])).filter((row) => row.slot < slotCount(state.wardrobe_bought));
    const tagged = loadouts.find((row) => row.auto_for === activity);
    if (tagged) return tagged.slot;

    // Fishing with none tagged: the first loadout with a rod, unless one's held.
    if (activity === "fishing") {
        const [held] = await tx<{ item_id: string }>(FIND_MAIN_HAND_ITEM, [playerId]);
        if (isRod(held?.item_id)) return null;
        const owned = await findOwned(tx, playerId, referencedIds(loadouts));
        return loadouts.find((row) => isRod(owned.get(row.equipment.mainHand ?? "")))?.slot ?? null;
    }
    return null;
}

/** Tags a saved loadout for an activity (taking the tag off any other), or untags it. */
export async function setAutoFor(tx: TxQuery, playerId: string, slot: number, autoFor: GeoLoadoutActivity | null) {
    if (autoFor) await tx(CLEAR_AUTO_FOR, [playerId, autoFor]);
    const [row] = await tx<{ slot: number }>(SET_AUTO_FOR, [playerId, slot, autoFor]);
    if (!row) throw AppError.notFound("Nothing saved in that loadout slot");
}

/** The next slot's price, or refused at the max. Call with the player locked, then `addBoughtSlot` once paid. */
export async function quoteSlot(tx: TxQuery, playerId: string): Promise<number> {
    const cost = nextSlotCost((await findState(tx, playerId)).wardrobe_bought);
    if (cost === null) throw AppError.badRequest("Your wardrobe has every slot it can");
    return cost;
}

export async function addBoughtSlot(tx: TxQuery, playerId: string) {
    await tx(ADD_BOUGHT_SLOT, [playerId]);
}
