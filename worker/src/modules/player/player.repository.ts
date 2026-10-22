import {
    geoSkillLevel,
    type GeoBait,
    type GeoCamp,
    type GeoDeathCause,
    type GeoEquipmentSlot,
    type GeoHealth,
    type GeoInventoryEntry,
    type GeoLunchbox,
    type GeoMeResponse,
    type GeoPetUpgrade,
    type GeoPlayer,
    type GeoPoint,
    type GeoSavedHand,
} from "@geo/shared";
import { CONTENT, GAME_CONFIG } from "../../../../game/src/content";
import { isStackable } from "../../../../game/src/content/content.types";
import type { StatModifier } from "../../../../game/src/engine/engine.types";
import { AppError } from "../../../../game/src/http/AppError";
import { campMovableAt, currentHealth } from "../../../../game/src/modules/player/geo-camp.rules";
import { activePetModifierSources, NEW_PET, petOf, petState, petXpFrom, type PetCopy } from "../../../../game/src/pets/pets";
import { maxHealthFrom, ownModifiersFrom } from "../../../../game/src/world/modifiers";
import { statSheet } from "../../../../game/src/world/stat-sheet";
import type { Db } from "../../db/db";
import { globalModifiers } from "../mayor/mayor.repository";
import { findWardrobe } from "../wardrobe/wardrobe.repository";
import * as sql from "./player.sql.ts";
import type {
    EquipmentRow,
    HandRow,
    InventoryRecord,
    InventoryRow,
    PetUpgradeRecord,
    PlayerRow,
    PlayerStateRow,
    SavedHandRow,
    SkillXpRow,
    SlotRow,
    TalismanBagRow,
    UsesRow,
} from "./player.types";

/**
 * The player's own state.
 * Every function is synchronous: a caller that writes runs it inside one
 * `db.transaction`, which is all the locking the World needs, so there is no
 * `lockPlayer` here.
 */

const iso = (ms: number) => new Date(ms).toISOString();

export function toPlayer(row: PlayerRow): GeoPlayer {
    return {
        id: row.id,
        displayName: row.display_name,
        coins: row.coins,
        bankCoins: row.bank_coins,
        role: row.role,
        createdAt: iso(row.created_at),
    };
}

function parseInventory(row: InventoryRecord): InventoryRow {
    return { ...row, pet: row.pet === null ? null : (JSON.parse(row.pet) as PetCopy) };
}

export function toInventoryEntry(row: InventoryRow): GeoInventoryEntry {
    return {
        id: row.id,
        itemId: row.item_id,
        quantity: row.quantity,
        chargesLeft: row.charges_left,
        reforge: row.reforge,
        pet: petState(row.item_id, row.pet ?? NEW_PET),
        obtainedAt: iso(row.obtained_at),
    };
}

export function findPlayer(db: Db, playerId: string): GeoPlayer | null {
    const row = db.one<PlayerRow>(sql.FIND_PLAYER, playerId);
    return row ? toPlayer(row) : null;
}

function findState(db: Db, playerId: string): PlayerStateRow | undefined {
    return db.one<PlayerStateRow>(sql.FIND_PLAYER_STATE, playerId);
}

export function findInventory(db: Db, playerId: string): InventoryRow[] {
    return db.all<InventoryRecord>(sql.FIND_INVENTORY, playerId).map(parseInventory);
}

export function findInventoryByIds(db: Db, playerId: string, ids: string[]): InventoryRow[] {
    if (ids.length === 0) return [];
    return db.all<InventoryRecord>(sql.FIND_INVENTORY_BY_IDS, playerId, JSON.stringify(ids)).map(parseInventory);
}

/** One owned row, or null if the player doesn't own it. */
export function findInventoryRow(db: Db, playerId: string, inventoryId: string): InventoryRow | null {
    const row = db.one<InventoryRecord>(sql.FIND_INVENTORY_ROW, playerId, inventoryId);
    return row ? parseInventory(row) : null;
}

export function findEquipment(db: Db, playerId: string): EquipmentRow[] {
    return db.all<EquipmentRow>(sql.FIND_EQUIPMENT, playerId);
}

export function findTalismanBag(db: Db, playerId: string): TalismanBagRow[] {
    return db.all<TalismanBagRow>(sql.FIND_TALISMAN_BAG, playerId);
}

export function findTalismanBagPages(db: Db, playerId: string): number {
    return findState(db, playerId)?.talisman_bag_pages ?? 1;
}

export function findHand(db: Db, playerId: string, skill: string): string[] {
    const row = db.one<HandRow>(sql.FIND_HAND, playerId, skill);
    return row ? (JSON.parse(row.inventory_ids) as string[]) : [];
}

/** Modifiers from the player's own gear, bagged talismans and active pet. */
export function ownModifiers(db: Db, playerId: string): StatModifier[] {
    const worn = findInventoryByIds(db, playerId, findEquipment(db, playerId).map((slot) => slot.inventory_id));
    return ownModifiersFrom({
        worn: worn.map((row) => ({ itemId: row.item_id, reforge: row.reforge })),
        talismans: findTalismanBag(db, playerId).map((entry) => entry.item_id),
        pet: findActivePet(db, playerId) ?? undefined,
    });
}

/** Everything that changes a player's stats outside a fight: global effects, then their own. */
export function playerModifiers(db: Db, playerId: string): StatModifier[] {
    return [...globalModifiers(db), ...ownModifiers(db, playerId)];
}

/** Max health from the player's gear right now, as a fight would start them. */
export function playerMaxHealth(db: Db, playerId: string): number {
    return maxHealthFrom(playerModifiers(db, playerId));
}

/** Everything `GET /geo/me` returns. */
export function findMe(db: Db, playerId: string): GeoMeResponse | null {
    const player = findPlayer(db, playerId);
    const state = findState(db, playerId);
    if (!player || !state) return null;

    const inventory = findInventory(db, playerId);
    const equipment = findEquipment(db, playerId);
    const talismanBag = findTalismanBag(db, playerId);
    const hands = db.all<HandRow>(sql.FIND_HANDS, playerId);
    const xp = db.all<SkillXpRow>(sql.FIND_SKILL_XP, playerId);
    const savedHands = db.all<SavedHandRow>(sql.FIND_SAVED_HANDS, playerId);
    const activePet = findActivePet(db, playerId);
    const petUpgrade = findPetUpgrade(db, playerId);
    const global = globalModifiers(db);

    const byId = new Map(inventory.map((row) => [row.id, row]));
    const worn = equipment.flatMap((slot) => byId.get(slot.inventory_id) ?? []);
    const combatXp = xp.find((row) => row.skill === "combat")?.xp ?? 0;
    const max = maxHealthFrom([
        ...global,
        ...ownModifiersFrom({
            worn: worn.map((row) => ({ itemId: row.item_id, reforge: row.reforge })),
            talismans: talismanBag.map((row) => row.item_id),
            pet: activePet ?? undefined,
        }),
    ]);

    return {
        player,
        inventory: inventory.map(toInventoryEntry),
        equipment: Object.fromEntries(equipment.map((row) => [row.slot as GeoEquipmentSlot, row.inventory_id])),
        talismanBag: { pages: state.talisman_bag_pages, inventoryIds: talismanBag.map((row) => row.inventory_id) },
        hands: Object.fromEntries(hands.map((row) => [row.skill, JSON.parse(row.inventory_ids) as string[]])),
        skillXp: Object.fromEntries(xp.map((row) => [row.skill, row.xp])),
        savedHands: savedHands.map(toSavedHand),
        lunchbox: { slots: state.lunchbox_slots, contents: slotsOf(db.all<SlotRow>(sql.FIND_LUNCHBOX, playerId)) },
        bait: { slots: state.bait_slots, contents: slotsOf(db.all<SlotRow>(sql.FIND_BAIT, playerId)) },
        health: { current: currentHealth(state.health, max), max },
        camp: toCamp(state),
        activePet: activePet?.id ?? null,
        petUpgrade: petUpgrade && toPetUpgrade(petUpgrade),
        heldItemRemovalCost: GAME_CONFIG.pets.heldItemRemovalCost,
        stats: statSheet({
            worn: worn.map((row) => ({ itemId: row.item_id, reforge: row.reforge })),
            talismans: talismanBag.map((row) => row.item_id),
            pet: activePetModifierSources(activePet ?? undefined),
            combatLevel: geoSkillLevel(combatXp),
            globalModifiers: global,
        }),
        wardrobe: findWardrobe(db, playerId),
    };
}

/** `findMe`, or a 404 when the player is gone: every `/geo/me` reply. */
export function requireMe(db: Db, playerId: string): GeoMeResponse {
    const me = findMe(db, playerId);
    if (!me) throw AppError.notFound("Player not found");
    return me;
}

function toPetUpgrade(row: PetUpgradeRecord): GeoPetUpgrade {
    return { inventoryId: row.inventory_id, itemId: row.item_id, toItemId: row.to_item_id, readyAt: iso(row.ready_at) };
}

/** The active pet's inventory row, or null. */
export function findActivePet(db: Db, playerId: string): InventoryRow | null {
    const row = db.one<InventoryRecord>(sql.FIND_ACTIVE_PET, playerId);
    return row ? parseInventory(row) : null;
}

/** null puts the active pet away. The caller checks the copy is the player's pet. */
export function setActivePet(db: Db, playerId: string, inventoryId: string | null) {
    if (inventoryId) db.run(sql.SET_ACTIVE_PET, playerId, inventoryId);
    else db.run(sql.CLEAR_ACTIVE_PET, playerId);
}

/** What a pet copy holds now: a pet item's id, or null. */
export function setPetHeldItem(db: Db, playerId: string, inventoryId: string, heldItem: string | null) {
    if (!db.one(sql.SET_PET_HELD_ITEM, JSON.stringify(heldItem), playerId, inventoryId)) {
        throw AppError.notFound("You don't own that pet");
    }
}

/** The pet left with Kat, as stored, or null. */
export function findPetUpgrade(db: Db, playerId: string): PetUpgradeRecord | null {
    return db.one<PetUpgradeRecord>(sql.FIND_PET_UPGRADE, playerId) ?? null;
}

/** Leaves a pet copy with Kat; the caller has already taken it out of the inventory. */
export function insertPetUpgrade(db: Db, playerId: string, taken: InventoryRow, toItemId: string, readyAt: number) {
    db.run(sql.INSERT_PET_UPGRADE, playerId, taken.id, taken.item_id, toItemId, JSON.stringify(taken.pet ?? NEW_PET), taken.obtained_at, readyAt);
}

/** Takes the pet back from Kat (the row goes), or null if there was none. */
export function takePetUpgrade(db: Db, playerId: string): PetUpgradeRecord | null {
    return db.one<PetUpgradeRecord>(sql.DELETE_PET_UPGRADE, playerId) ?? null;
}

/** Health carried between fights, against max health from the player's gear now. */
export function findHealth(db: Db, playerId: string): GeoHealth {
    const max = playerMaxHealth(db, playerId);
    return { current: currentHealth(findState(db, playerId)?.health ?? null, max), max };
}

/** Saves health between fights; at or above max it's stored as full. */
export function setHealth(db: Db, playerId: string, health: number, max: number) {
    db.run(sql.SET_HEALTH, health >= max ? null : Math.max(1, Math.round(health)), playerId);
}

function toCamp(state: PlayerStateRow): GeoCamp | null {
    if (state.camp_latitude === null || state.camp_longitude === null || state.camp_set_at === null) return null;
    return {
        position: { latitude: state.camp_latitude, longitude: state.camp_longitude },
        setAt: iso(state.camp_set_at),
        movableAt: campMovableAt(new Date(state.camp_set_at)).toISOString(),
    };
}

/** The player's camp, or null if none is set (or it was forgotten). */
export function findCamp(db: Db, playerId: string): GeoCamp | null {
    const state = findState(db, playerId);
    return state ? toCamp(state) : null;
}

/** When camp was last set, even if it's since been forgotten. */
export function findCampSetAt(db: Db, playerId: string): Date | null {
    const setAt = findState(db, playerId)?.camp_set_at;
    return setAt === null || setAt === undefined ? null : new Date(setAt);
}

/** `point` must already be rounded (roundCamp). */
export function setCamp(db: Db, playerId: string, point: GeoPoint) {
    db.run(sql.SET_CAMP, point.latitude, point.longitude, Date.now(), playerId);
}

export function clearCamp(db: Db, playerId: string) {
    db.run(sql.CLEAR_CAMP, playerId);
}

/**
 * A packed slot of an item the content no longer has (renamed or removed)
 * counts as empty: the screens can't draw it and nothing can use it, so
 * packing just overwrites it.
 */
function slotsOf(rows: SlotRow[]) {
    return rows
        .filter((row) => CONTENT.items[row.item_id] !== undefined)
        .map((row) => ({ slot: row.slot, itemId: row.item_id, quantity: row.quantity }));
}

/** How many slots the player has unlocked, and what's packed in them. */
export function findLunchbox(db: Db, playerId: string): GeoLunchbox {
    return { slots: findState(db, playerId)?.lunchbox_slots ?? 1, contents: slotsOf(db.all<SlotRow>(sql.FIND_LUNCHBOX, playerId)) };
}

/** Puts a stack in a slot, replacing what was there. The caller moves the items. */
export function setLunchboxSlot(db: Db, playerId: string, slot: number, itemId: string, quantity: number) {
    db.run(sql.UPSERT_LUNCHBOX_SLOT, playerId, slot, itemId, quantity);
}

/**
 * Saves what's left in a slot after eating, from `from` down to `to`; an
 * emptied slot is cleared. Throws unless the slot still holds exactly `from`
 * of that food, so a fight can never eat food that's no longer there.
 */
export function eatFromLunchbox(db: Db, playerId: string, eaten: { slot: number; itemId: string; from: number; to: number }) {
    const { slot, itemId, from, to } = eaten;
    if (!(to >= 0 && to < from)) throw new Error(`Bad lunchbox change ${from} → ${to}`);
    const row =
        to > 0
            ? db.one(sql.EAT_FROM_LUNCHBOX, to, playerId, slot, itemId, from)
            : db.one(sql.EAT_LAST_FROM_LUNCHBOX, playerId, slot, itemId, from);
    if (!row) throw AppError.badRequest("That food is no longer in your lunchbox");
}

export function clearLunchboxSlot(db: Db, playerId: string, slot: number) {
    db.run(sql.DELETE_LUNCHBOX_SLOT, playerId, slot);
}

/** How many bait slots the player has unlocked, and what's packed in them. */
export function findBait(db: Db, playerId: string): GeoBait {
    return { slots: findState(db, playerId)?.bait_slots ?? 1, contents: slotsOf(db.all<SlotRow>(sql.FIND_BAIT, playerId)) };
}

export function setBaitSlot(db: Db, playerId: string, slot: number, itemId: string, quantity: number) {
    db.run(sql.UPSERT_BAIT_SLOT, playerId, slot, itemId, quantity);
}

/** Puts one bait from a slot on the hook; throws unless the slot still holds exactly `from` of it. */
export function useBait(db: Db, playerId: string, used: { slot: number; itemId: string; from: number }) {
    const { slot, itemId, from } = used;
    const row = db.one(from > 1 ? sql.USE_BAIT : sql.USE_LAST_BAIT, playerId, slot, itemId, from);
    if (!row) throw AppError.badRequest("That bait is no longer packed");
}

export function clearBaitSlot(db: Db, playerId: string, slot: number) {
    db.run(sql.DELETE_BAIT_SLOT, playerId, slot);
}

function toSavedHand(row: SavedHandRow): GeoSavedHand {
    return {
        id: row.id,
        skill: row.skill,
        name: row.name,
        inventoryIds: JSON.parse(row.inventory_ids) as string[],
        createdAt: iso(row.created_at),
    };
}

export function findSavedHand(db: Db, playerId: string, savedHandId: string): GeoSavedHand | null {
    const row = db.one<SavedHandRow>(sql.FIND_SAVED_HAND, playerId, savedHandId);
    return row ? toSavedHand(row) : null;
}

export function countSavedHands(db: Db, playerId: string, skill: string): number {
    return db.one<{ count: number }>(sql.COUNT_SAVED_HANDS, playerId, skill)?.count ?? 0;
}

export function insertSavedHand(db: Db, playerId: string, skill: string, name: string, inventoryIds: string[]) {
    db.run(sql.INSERT_SAVED_HAND, playerId, crypto.randomUUID(), skill, name, JSON.stringify(inventoryIds), Date.now());
}

export function deleteSavedHand(db: Db, playerId: string, savedHandId: string) {
    db.run(sql.DELETE_SAVED_HAND, playerId, savedHandId);
}

export type ItemGrant = { itemId: string; quantity: number; chargesLeft?: number; reforge?: string | null; pet?: PetCopy | null };

/**
 * Adds items to a player's inventory. Stackable kinds join an existing
 * stack; cards arrive with full charges unless `chargesLeft` says otherwise,
 * one row per copy; gear and talismans one row each, keeping `reforge` if
 * given. Returns the new or updated row ids. Unknown item ids throw, so a
 * content typo can't silently drop loot.
 */
export function grantItems(db: Db, playerId: string, grants: ItemGrant[]): string[] {
    const ids: string[] = [];
    const now = Date.now();
    for (const { itemId, quantity, chargesLeft, reforge, pet } of grants) {
        const item = CONTENT.items[itemId];
        if (!item) throw new Error(`Unknown item "${itemId}"`);

        if (isStackable(item)) {
            const stacked = db.one<{ id: string }>(sql.ADD_TO_STACK, quantity, playerId, playerId, itemId);
            if (stacked) {
                ids.push(stacked.id);
                continue;
            }
            const id = crypto.randomUUID();
            db.run(sql.INSERT_INVENTORY, playerId, id, itemId, quantity, null, null, null, now);
            ids.push(id);
            continue;
        }

        const charges = item.kind === "card" ? (chargesLeft ?? item.maxCharges) : null;
        // A new pet starts at level 1 with nothing held.
        const copy = item.kind === "pet" ? JSON.stringify(pet ?? NEW_PET) : null;
        for (let i = 0; i < quantity; i++) {
            const id = crypto.randomUUID();
            db.run(sql.INSERT_INVENTORY, playerId, id, itemId, 1, charges, reforge ?? null, copy, now);
            ids.push(id);
        }
    }
    return ids;
}

/** Why coins moved, as the ledger records it. */
export type CoinReason =
    | "run-loot"
    | "quest-reward"
    | "chest-open"
    | "run-defeat"
    | GeoDeathCause
    | "vendor-buy"
    | "farm-tile"
    | "research-lab"
    | "farm-order"
    | "farm-contest"
    | "vendor-sell"
    | "vendor-reforge"
    | "pet-upgrade"
    | "pet-item-removal"
    | "market-fee"
    | "market-bid-hold"
    | "market-bid-return"
    | "market-buy"
    | "market-collect"
    | "admin-grant"
    | "bank-deposit"
    | "bank-withdraw"
    | "wardrobe-slot";

/** Sets one owned copy's reforge. */
export function setReforge(db: Db, playerId: string, inventoryId: string, reforgeId: string) {
    if (!db.one(sql.SET_REFORGE, reforgeId, playerId, inventoryId)) throw AppError.notFound("You don't own that item");
}

function ledger(db: Db, playerId: string, delta: number, reason: CoinReason, reference: string | null) {
    db.run(sql.INSERT_COIN_LEDGER, playerId, delta, reason, reference, Date.now());
}

/** Adds coins (or takes them, with a negative amount) and records why. */
export function addCoins(db: Db, playerId: string, amount: number, reason: CoinReason, reference: string) {
    if (amount === 0) return;
    db.run(sql.ADD_COINS, amount, playerId);
    ledger(db, playerId, amount, reason, reference);
}

/** Takes every coin the player has and records it. Returns how many. */
export function loseAllCoins(db: Db, playerId: string, reason: CoinReason, reference: string): number {
    const lost = db.one<{ coins: number }>(sql.FIND_COINS, playerId)?.coins ?? 0;
    if (lost > 0) addCoins(db, playerId, -lost, reason, reference);
    return lost;
}

/**
 * Takes `amount` coins, or refuses with "Not enough coins" and takes none.
 * Every purchase goes through here before anything is handed over.
 */
export function spendCoins(db: Db, playerId: string, amount: number, reason: CoinReason, reference: string) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`Bad coin amount ${amount}`);
    if (amount === 0) return;
    if (!db.one(sql.SPEND_COINS, amount, playerId, amount)) throw AppError.badRequest("Not enough coins");
    ledger(db, playerId, -amount, reason, reference);
}

/**
 * Moves coins between the purse and the bank at camp, or refuses and moves
 * none. The ledger records the purse's side.
 */
export function moveBankCoins(db: Db, playerId: string, direction: "deposit" | "withdraw", amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Bad coin amount ${amount}`);
    const moved = db.one(direction === "deposit" ? sql.BANK_DEPOSIT : sql.BANK_WITHDRAW, amount, amount, playerId, amount);
    if (!moved) throw AppError.badRequest(direction === "deposit" ? "Not enough coins" : "Not enough coins in the bank");
    ledger(db, playerId, direction === "deposit" ? -amount : amount, `bank-${direction}`, null);
}

/**
 * Saves a card's charges. Throws if the card has left the player's inventory,
 * so a fight can never keep using a card that's gone.
 */
export function setCharges(db: Db, playerId: string, inventoryId: string, charges: number) {
    if (!db.one(sql.SET_CHARGES, charges, playerId, inventoryId)) {
        throw AppError.badRequest("That card is no longer in your inventory");
    }
}

/** Takes `inventoryId` out of any slot it's in, then puts it in `slot`. */
export function equip(db: Db, playerId: string, slot: string, inventoryId: string) {
    db.run(sql.UNEQUIP_INVENTORY, playerId, inventoryId);
    db.run(sql.UPSERT_EQUIPMENT, playerId, slot, inventoryId);
}

export function clearSlot(db: Db, playerId: string, slot: string) {
    db.run(sql.CLEAR_SLOT, playerId, slot);
}

export function addToTalismanBag(db: Db, playerId: string, itemId: string, inventoryId: string) {
    db.run(sql.INSERT_TALISMAN_BAG, playerId, itemId, inventoryId);
}

export function removeFromTalismanBag(db: Db, playerId: string, inventoryId: string) {
    db.run(sql.DELETE_TALISMAN_BAG, playerId, inventoryId);
}

export function setHand(db: Db, playerId: string, skill: string, inventoryIds: string[]) {
    db.run(sql.UPSERT_HAND, playerId, skill, JSON.stringify(inventoryIds));
}

/** The player's level in every skill they have XP in; others are level 1. */
export function findSkillLevels(db: Db, playerId: string): Record<string, number> {
    const rows = db.all<SkillXpRow>(sql.FIND_SKILL_XP, playerId);
    return Object.fromEntries(rows.map((row) => [row.skill, geoSkillLevel(row.xp)]));
}

/** Adds skill XP, and the active pet's share of it (pets/pets.ts petXpFrom). */
export function addSkillXp(db: Db, playerId: string, skill: string, amount: number) {
    if (amount <= 0) return;
    db.run(sql.ADD_SKILL_XP, playerId, skill, amount);

    const active = findActivePet(db, playerId);
    const found = active ? petOf(active.item_id) : null;
    if (!active || !found) return;
    const gained = petXpFrom(found.pet, skill, amount, active.pet?.heldItem ?? null);
    if (gained > 0) db.run(sql.ADD_PET_XP, gained, playerId, active.id);
}

/**
 * Refuses if the row is worn, in the Talisman Bag, in a hand or the active
 * pet: selling or listing it would pull it out of the player's build
 * without them noticing.
 */
export function assertNotInUse(db: Db, playerId: string, inventoryId: string, name: string) {
    const uses = db.one<UsesRow>(sql.FIND_USES, ...Array.from({ length: 4 }, () => [playerId, inventoryId]).flat());
    if (uses?.equipped) throw AppError.badRequest(`Unequip ${name} first`);
    if (uses?.active_pet) throw AppError.badRequest(`Put ${name} away first`);
    if (uses?.bagged) throw AppError.badRequest(`Take ${name} out of the Talisman Bag first`);
    if (uses?.in_hand) throw AppError.badRequest(`Take ${name} out of your hand first`);
}

/**
 * Takes `quantity` of an item from wherever the player has it free, oldest
 * rows first, e.g. a recipe's inputs. Rows worn, bagged or in a hand are
 * never touched, and a card counts only at full charge. Refuses, taking
 * nothing, when there isn't enough.
 */
export function takeItems(db: Db, playerId: string, itemId: string, quantity: number) {
    const item = CONTENT.items[itemId];
    if (!item) throw new Error(`Unknown item "${itemId}"`);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error(`Bad quantity ${quantity}`);
    const rows = db
        .all<InventoryRecord>(sql.FIND_FREE_ROWS_OF_ITEM, playerId, itemId)
        .filter((row) => item.kind !== "card" || row.charges_left === item.maxCharges);
    const have = rows.reduce((sum, row) => sum + row.quantity, 0);
    if (have < quantity) throw AppError.badRequest(`You need ${quantity} ${item.name} and have ${have} free`);

    let left = quantity;
    for (const row of rows) {
        if (left === 0) break;
        const taken = Math.min(left, row.quantity);
        if (taken === row.quantity) db.run(sql.DELETE_INVENTORY_ROW, playerId, row.id);
        else db.run(sql.TAKE_FROM_STACK, taken, playerId, row.id);
        left -= taken;
    }
}

/**
 * Takes `quantity` of an owned row out of the inventory: the whole row when
 * that's all of it, else just that many from the stack. Returns the row as
 * it was, so the copy can be restored or handed on. Refuses an item in use.
 */
export function takeFromInventory(db: Db, playerId: string, inventoryId: string, quantity: number): InventoryRow {
    const row = findInventoryRow(db, playerId, inventoryId);
    if (!row) throw AppError.notFound("You don't own that item");
    const name = CONTENT.items[row.item_id]?.name ?? "that item";
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw AppError.badRequest("Choose at least 1");
    if (quantity > row.quantity) throw AppError.badRequest(`You only have ${row.quantity} ${name}`);
    assertNotInUse(db, playerId, inventoryId, name);

    if (quantity === row.quantity) db.run(sql.DELETE_INVENTORY_ROW, playerId, inventoryId);
    else db.run(sql.TAKE_FROM_STACK, quantity, playerId, inventoryId);
    return row;
}

/**
 * Hands a single copy back as it was (same id and obtained date), e.g. a
 * cancelled listing. A stackable joins the player's stack instead.
 */
export function restoreItem(
    db: Db,
    playerId: string,
    copy: {
        inventoryId: string | null;
        itemId: string;
        quantity: number;
        chargesLeft: number | null;
        reforge: string | null;
        pet?: PetCopy | null;
        obtainedAt: number;
    },
) {
    const item = CONTENT.items[copy.itemId];
    if (!item) throw new Error(`Unknown item "${copy.itemId}"`);
    const grant = { itemId: copy.itemId, chargesLeft: copy.chargesLeft ?? undefined, reforge: copy.reforge, pet: copy.pet };
    if (isStackable(item) || !copy.inventoryId) {
        grantItems(db, playerId, [{ ...grant, quantity: copy.quantity }]);
        return;
    }
    const restored = db.one(
        sql.RESTORE_INVENTORY_ROW,
        playerId,
        copy.inventoryId,
        copy.itemId,
        1,
        copy.chargesLeft,
        copy.reforge,
        item.kind === "pet" ? JSON.stringify(copy.pet ?? NEW_PET) : null,
        copy.obtainedAt,
    );
    // The id was somehow taken: hand it back as a new copy rather than lose it.
    if (!restored) grantItems(db, playerId, [{ ...grant, quantity: 1 }]);
}
