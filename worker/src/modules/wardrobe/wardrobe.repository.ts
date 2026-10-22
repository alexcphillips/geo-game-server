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
import { CONTENT, GAME_CONFIG } from "../../../../server/src/content";
import { AppError } from "../../../../server/src/http/AppError";
import type { Db } from "../../db/db";
import { CLEAR_ACTIVE_PET, CLEAR_EQUIPMENT, FIND_SKILL_XP, SET_ACTIVE_PET, UNEQUIP_INVENTORY, UPSERT_EQUIPMENT } from "../player/player.sql.ts";
import type { SkillXpRow } from "../player/player.types";
import * as sql from "./wardrobe.sql.ts";

/**
 * The wardrobe's storage, from server/src/modules/wardrobe/geo-wardrobe.repository.ts.
 * No player-repository import: `findMe` reads the wardrobe from here, and the
 * equipment and pet writes share its SQL. Coins for upgrades are spent by the controller.
 */

type WardrobeStateRow = { wardrobe_bought: number; active_loadout: number | null };
/** `equipment` is JSON { slot: inventory id }. */
type LoadoutRecord = { slot: number; name: string; equipment: string; pet_id: string | null; auto_for: GeoLoadoutActivity | null };
type LoadoutRow = Omit<LoadoutRecord, "equipment"> & { equipment: Record<string, string> };
type OwnedRow = { id: string; item_id: string };

const parseLoadout = (row: LoadoutRecord): LoadoutRow => ({ ...row, equipment: JSON.parse(row.equipment) as Record<string, string> });

const referencedIds = (rows: LoadoutRow[]) => [
    ...new Set(rows.flatMap((row) => [...Object.values(row.equipment), ...(row.pet_id ? [row.pet_id] : [])])),
];

function findOwned(db: Db, playerId: string, ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map();
    return new Map(db.all<OwnedRow>(sql.FIND_OWNED, playerId, JSON.stringify(ids)).map((row) => [row.id, row.item_id]));
}

function findLoadouts(db: Db, playerId: string): LoadoutRow[] {
    return db.all<LoadoutRecord>(sql.FIND_LOADOUTS, playerId).map(parseLoadout);
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

function findState(db: Db, playerId: string): WardrobeStateRow {
    const row = db.one<WardrobeStateRow>(sql.FIND_WARDROBE_STATE, playerId);
    if (!row) throw AppError.notFound("Player not found");
    return row;
}

/** The wardrobe as the app sees it: references to items no longer owned are left out. */
export function findWardrobe(db: Db, playerId: string): GeoWardrobe {
    const state = findState(db, playerId);
    const rows = findLoadouts(db, playerId);
    const owned = findOwned(db, playerId, referencedIds(rows));
    const slots = slotCount(state.wardrobe_bought);

    const loadouts = rows
        .filter((row) => row.slot < slots)
        .map(
            (row): GeoLoadout => ({
                slot: row.slot,
                name: row.name,
                equipment: Object.fromEntries(Object.entries(row.equipment).filter(([, id]) => owned.has(id))) as Partial<
                    Record<GeoEquipmentSlot, string>
                >,
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
export function assertSlotOwned(db: Db, playerId: string, slot: number) {
    const state = findState(db, playerId);
    if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount(state.wardrobe_bought)) {
        throw AppError.badRequest("You don't have that loadout slot");
    }
}

/** Stores what's worn in the slot under `name`, and makes it the active loadout. */
export function saveWorn(db: Db, playerId: string, slot: number, name: string) {
    db.run(sql.SAVE_WORN, playerId, slot, name, playerId, playerId);
    db.run(sql.SET_ACTIVE, slot, playerId);
}

/** A loadout built elsewhere (the starter kit): slot → inventory id. */
export function insertLoadout(
    db: Db,
    playerId: string,
    slot: number,
    name: string,
    equipment: Partial<Record<GeoEquipmentSlot, string>>,
    petId: string | null,
    autoFor: GeoLoadoutActivity | null,
) {
    db.run(sql.INSERT_LOADOUT, playerId, slot, name, JSON.stringify(equipment), petId, autoFor);
}

export function renameLoadout(db: Db, playerId: string, slot: number, name: string) {
    if (!db.one(sql.RENAME_LOADOUT, name, playerId, slot)) throw AppError.notFound("Nothing saved in that loadout slot");
}

/** Clears the slot, and the active mark if it pointed there. */
export function deleteLoadout(db: Db, playerId: string, slot: number) {
    db.run(sql.DELETE_LOADOUT, playerId, slot);
    db.run(sql.UNSET_ACTIVE, playerId, slot);
}

/** After any change to worn gear or the pet: the active loadout follows it. */
export function syncActiveLoadout(db: Db, playerId: string) {
    db.run(sql.SYNC_ACTIVE, playerId, playerId, playerId, playerId);
}

/**
 * Wears a saved loadout: everything worn comes off, then each of its items
 * that's still owned, still fits and whose skill levels the player has goes
 * on, and its pet comes out (or none). Anything else is skipped, not
 * refused. The caller checks the player isn't mid-Run (or is starting one).
 */
export function wearLoadout(db: Db, playerId: string, slot: number) {
    const record = db.one<LoadoutRecord>(sql.FIND_LOADOUT, playerId, slot);
    if (!record) throw AppError.notFound("Nothing saved in that loadout slot");
    const row = parseLoadout(record);
    const owned = findOwned(db, playerId, referencedIds([row]));
    const levels = Object.fromEntries(
        db.all<SkillXpRow>(FIND_SKILL_XP, playerId).map((entry) => [entry.skill, geoSkillLevel(entry.xp)]),
    );

    db.run(CLEAR_EQUIPMENT, playerId);
    for (const [equipSlot, inventoryId] of Object.entries(row.equipment)) {
        if (!GEO_EQUIPMENT_SLOTS.includes(equipSlot as GeoEquipmentSlot)) continue;
        const item = CONTENT.items[owned.get(inventoryId) ?? ""];
        if (item?.kind !== "equipment" || item.slot !== geoSlotKind(equipSlot as GeoEquipmentSlot)) continue;
        if (geoUnmetSkill(levels, item.skills)) continue;
        db.run(UNEQUIP_INVENTORY, playerId, inventoryId);
        db.run(UPSERT_EQUIPMENT, playerId, equipSlot, inventoryId);
    }

    const pet = row.pet_id ? CONTENT.items[owned.get(row.pet_id) ?? ""] : undefined;
    if (row.pet_id && pet?.kind === "pet") db.run(SET_ACTIVE_PET, playerId, row.pet_id);
    else db.run(CLEAR_ACTIVE_PET, playerId);

    db.run(sql.SET_ACTIVE, slot, playerId);
}

/**
 * What's starting, for auto-swap to pick a loadout by. It carries what a
 * player-set rule could match on later ("entering this dungeon", "fighting
 * this creature"); for now only the activity decides.
 */
export type LoadoutTrigger = { activity: "fishing" } | { activity: "combat"; enemyId: string; dungeonId: string | null };

const isRod = (itemId: string | undefined) => {
    const item = itemId ? CONTENT.items[itemId] : undefined;
    return item?.kind === "equipment" && !!item.rod;
};

/**
 * As an activity starts (a fight, a fishing Run or a step in one): wears the
 * loadout auto-swap picks for it, if it isn't already worn. In the Run's own
 * transaction, before the player's gear is read. Returns whether it swapped.
 */
export function autoSwap(db: Db, playerId: string, trigger: LoadoutTrigger): boolean {
    const state = findState(db, playerId);
    const target = pickAutoLoadout(db, playerId, state, trigger);
    if (target === null || target === state.active_loadout) return false;
    wearLoadout(db, playerId, target);
    return true;
}

/**
 * The loadout slot auto-swap wears for a trigger, or null to leave gear be.
 * The one place that decides, so player-set rules go here, ahead of the
 * activity tags.
 */
function pickAutoLoadout(db: Db, playerId: string, state: WardrobeStateRow, trigger: LoadoutTrigger): number | null {
    const { activity } = trigger;
    // A slot no longer owned (fewer starting slots in config) isn't worn.
    const loadouts = findLoadouts(db, playerId).filter((row) => row.slot < slotCount(state.wardrobe_bought));
    const tagged = loadouts.find((row) => row.auto_for === activity);
    if (tagged) return tagged.slot;

    // Fishing with none tagged: the first loadout with a rod, unless one's held.
    if (activity === "fishing") {
        if (isRod(db.one<{ item_id: string }>(sql.FIND_MAIN_HAND_ITEM, playerId)?.item_id)) return null;
        const owned = findOwned(db, playerId, referencedIds(loadouts));
        return loadouts.find((row) => isRod(owned.get(row.equipment.mainHand ?? "")))?.slot ?? null;
    }
    return null;
}

/** Tags a saved loadout for an activity (taking the tag off any other), or untags it. */
export function setAutoFor(db: Db, playerId: string, slot: number, autoFor: GeoLoadoutActivity | null) {
    if (autoFor) db.run(sql.CLEAR_AUTO_FOR, playerId, autoFor);
    if (!db.one(sql.SET_AUTO_FOR, autoFor, playerId, slot)) throw AppError.notFound("Nothing saved in that loadout slot");
}

/** The next slot's price, or refused at the max. Then `addBoughtSlot` once paid. */
export function quoteSlot(db: Db, playerId: string): number {
    const cost = nextSlotCost(findState(db, playerId).wardrobe_bought);
    if (cost === null) throw AppError.badRequest("Your wardrobe has every slot it can");
    return cost;
}

export function addBoughtSlot(db: Db, playerId: string) {
    db.run(sql.ADD_BOUGHT_SLOT, playerId);
}
