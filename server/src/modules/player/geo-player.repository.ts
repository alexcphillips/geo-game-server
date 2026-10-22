import type {
    GeoHealth,
    GeoCamp,
    GeoPoint,
    GeoBait,
    GeoBaitSlot,
    GeoDeathCause,
    GeoEquipmentSlot,
    GeoInventoryEntry,
    GeoLunchbox,
    GeoLunchboxSlot,
    GeoMeResponse,
    GeoPlayer,
    GeoSavedHand,
} from "@geo/shared";
import { geoSkillLevel, type GeoPetUpgrade } from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import { CONTENT, GAME_CONFIG } from "../../content";
import { activePetModifierSources, NEW_PET, petOf, petState, petXpFrom, type PetCopy } from "../../pets/pets";
import { isStackable } from "../../content/content.types";
import type { TxQuery } from "../../db/transaction";
import { globalModifiers, playerMaxHealth } from "../../world/global-effects";
import { statSheet } from "../../world/stat-sheet";
import { findWardrobe } from "../wardrobe/geo-wardrobe.repository";
import { currentHealth, campMovableAt } from "./geo-camp.rules";
import {
    ADD_COINS,
    CLEAR_CAMP,
    FIND_HEALTH_AND_CAMP,
    SET_HEALTH,
    SET_CAMP,
    EMPTY_COINS,
    INSERT_COIN_LEDGER,
    ADD_SKILL_XP,
    ADD_TO_STACK,
    CLEAR_SLOT,
    CLEAR_ACTIVE_PET,
    DELETE_PET_UPGRADE,
    FIND_ACTIVE_PET,
    FIND_PET_UPGRADE,
    INSERT_PET_UPGRADE,
    SET_ACTIVE_PET,
    ADD_PET_XP,
    SET_PET_HELD_ITEM,
    FIND_EQUIPMENT,
    FIND_HAND,
    FIND_HANDS,
    FIND_INVENTORY,
    FIND_INVENTORY_BY_IDS,
    FIND_PLAYER,
    FIND_SKILL_XP,
    INSERT_INVENTORY,
    SET_CHARGES,
    SET_REFORGE,
    UNEQUIP_INVENTORY,
    UPSERT_EQUIPMENT,
    UPSERT_HAND,
    DELETE_SAVED_HAND,
    DELETE_TALISMAN_BAG,
    FIND_TALISMAN_BAG,
    FIND_TALISMAN_BAG_PAGES,
    LOCK_TALISMAN_BAG_PAGES,
    INSERT_TALISMAN_BAG,
    FIND_SAVED_HAND,
    FIND_SAVED_HANDS,
    INSERT_SAVED_HAND,
    DELETE_INVENTORY_ROW,
    DELETE_BAIT_SLOT,
    USE_BAIT,
    USE_LAST_BAIT,
    DELETE_LUNCHBOX_SLOT,
    FIND_BAIT,
    FIND_BAIT_SLOTS,
    FIND_LUNCHBOX,
    FIND_LUNCHBOX_SLOTS,
    EAT_FROM_LUNCHBOX,
    EAT_LAST_FROM_LUNCHBOX,
    UPSERT_BAIT_SLOT,
    UPSERT_LUNCHBOX_SLOT,
    FIND_USES,
    LOCK_FREE_ROWS_OF_ITEM,
    LOCK_PLAYER,
    LOCK_INVENTORY_ROW,
    RESTORE_INVENTORY_ROW,
    SPEND_COINS,
    BANK_DEPOSIT,
    BANK_WITHDRAW,
    TAKE_FROM_STACK,
} from "./geo-player.sql";
import type {
    BaitRow,
    EquipmentRow,
    HealthAndCampRow,
    HandRow,
    InventoryRow,
    LunchboxRow,
    PetUpgradeRow,
    PlayerRow,
    SavedHandRow,
    SkillXpRow,
    TalismanBagRow,
} from "./geo-player.types";

/** The default query, for reads outside a transaction. */
const db: TxQuery = query;

export function toPlayer(row: PlayerRow): GeoPlayer {
    return {
        id: row.id,
        displayName: row.display_name,
        coins: Number(row.coins),
        bankCoins: Number(row.bank_coins),
        role: row.role,
        createdAt: row.created_at.toISOString(),
    };
}

export function toInventoryEntry(row: InventoryRow): GeoInventoryEntry {
    return {
        id: row.id,
        itemId: row.item_id,
        quantity: row.quantity,
        chargesLeft: row.charges_left,
        reforge: row.reforge,
        pet: petState(row.item_id, row.pet ?? NEW_PET),
        obtainedAt: row.obtained_at.toISOString(),
    };
}

export async function findPlayer(playerId: string, tx: TxQuery = db): Promise<GeoPlayer | null> {
    const [row] = await tx<PlayerRow>(FIND_PLAYER, [playerId]);
    return row ? toPlayer(row) : null;
}

export async function findInventoryByIds(
    playerId: string,
    ids: string[],
    tx: TxQuery = db,
): Promise<InventoryRow[]> {
    if (ids.length === 0) return [];
    return tx<InventoryRow>(FIND_INVENTORY_BY_IDS, [playerId, ids]);
}

export async function findEquipment(playerId: string, tx: TxQuery = db): Promise<EquipmentRow[]> {
    return tx<EquipmentRow>(FIND_EQUIPMENT, [playerId]);
}

export async function findTalismanBag(playerId: string, tx: TxQuery = db): Promise<TalismanBagRow[]> {
    return tx<TalismanBagRow>(FIND_TALISMAN_BAG, [playerId]);
}

/** How many bag pages the player has; `lock` holds the row until the transaction ends. */
export async function findTalismanBagPages(playerId: string, tx: TxQuery = db, lock = false): Promise<number> {
    const [row] = await tx<{ talisman_bag_pages: number }>(
        lock ? LOCK_TALISMAN_BAG_PAGES : FIND_TALISMAN_BAG_PAGES,
        [playerId],
    );
    return row?.talisman_bag_pages ?? 1;
}

export async function findHand(playerId: string, skill: string, tx: TxQuery = db): Promise<string[]> {
    const [row] = await tx<HandRow>(FIND_HAND, [playerId, skill]);
    return row?.inventory_ids ?? [];
}

export async function findInventory(playerId: string, tx: TxQuery = db): Promise<InventoryRow[]> {
    return tx<InventoryRow>(FIND_INVENTORY, [playerId]);
}

/** Everything `GET /geo/me` returns, in one round of reads. */
export async function findMe(playerId: string): Promise<GeoMeResponse | null> {
    const player = await findPlayer(playerId);
    if (!player) return null;

    const [inventory, equipment, talismanBag, bagPages, hands, xp, savedHands, lunchbox, bait, health, camp, activePet, petUpgrade, global, wardrobe] = await Promise.all([
        findInventory(playerId),
        findEquipment(playerId),
        findTalismanBag(playerId),
        findTalismanBagPages(playerId),
        query<HandRow>(FIND_HANDS, [playerId]),
        query<SkillXpRow>(FIND_SKILL_XP, [playerId]),
        query<SavedHandRow>(FIND_SAVED_HANDS, [playerId]),
        findLunchbox(playerId),
        findBait(playerId),
        findHealth(playerId),
        findCamp(playerId),
        findActivePet(playerId),
        findPetUpgrade(playerId),
        globalModifiers(),
        findWardrobe(playerId),
    ]);

    const byId = new Map(inventory.map((row) => [row.id, row]));
    const combatXp = xp.find((row) => row.skill === "combat")?.xp ?? 0;

    return {
        player,
        inventory: inventory.map(toInventoryEntry),
        equipment: Object.fromEntries(
            equipment.map((row) => [row.slot as GeoEquipmentSlot, row.inventory_id]),
        ),
        talismanBag: {
            pages: bagPages,
            inventoryIds: talismanBag.map((row) => row.inventory_id),
        },
        hands: Object.fromEntries(hands.map((row) => [row.skill, row.inventory_ids])),
        skillXp: Object.fromEntries(xp.map((row) => [row.skill, Number(row.xp)])),
        savedHands: savedHands.map(toSavedHand),
        lunchbox,
        bait,
        health,
        camp,
        activePet: activePet?.id ?? null,
        petUpgrade: petUpgrade && toPetUpgrade(petUpgrade),
        heldItemRemovalCost: GAME_CONFIG.pets.heldItemRemovalCost,
        stats: statSheet({
            worn: equipment.flatMap((slot) => {
                const row = byId.get(slot.inventory_id);
                return row ? [{ itemId: row.item_id, reforge: row.reforge }] : [];
            }),
            talismans: talismanBag.map((row) => row.item_id),
            pet: activePetModifierSources(activePet ?? undefined),
            combatLevel: geoSkillLevel(Number(combatXp)),
            globalModifiers: global,
        }),
        wardrobe,
    };
}

function toPetUpgrade(row: PetUpgradeRow): GeoPetUpgrade {
    return {
        inventoryId: row.inventory_id,
        itemId: row.item_id,
        toItemId: row.to_item_id,
        readyAt: row.ready_at.toISOString(),
    };
}

/** The active pet's inventory row, or null. */
export async function findActivePet(playerId: string, tx: TxQuery = db): Promise<InventoryRow | null> {
    const [row] = await tx<InventoryRow>(FIND_ACTIVE_PET, [playerId]);
    return row ?? null;
}

/** null puts the active pet away. The caller checks the copy is the player's pet. */
export async function setActivePet(tx: TxQuery, playerId: string, inventoryId: string | null) {
    if (inventoryId) await tx(SET_ACTIVE_PET, [playerId, inventoryId]);
    else await tx(CLEAR_ACTIVE_PET, [playerId]);
}

/** What a pet copy holds now: a pet item's id, or null. */
export async function setPetHeldItem(tx: TxQuery, playerId: string, inventoryId: string, heldItem: string | null) {
    const [row] = await tx<{ id: string }>(SET_PET_HELD_ITEM, [playerId, inventoryId, JSON.stringify(heldItem)]);
    if (!row) throw AppError.notFound("You don't own that pet");
}

/** The pet left with Kat, or null. */
export async function findPetUpgrade(playerId: string, tx: TxQuery = db): Promise<PetUpgradeRow | null> {
    const [row] = await tx<PetUpgradeRow>(FIND_PET_UPGRADE, [playerId]);
    return row ?? null;
}

/** Leaves a pet copy with Kat; the caller has already taken it out of the inventory. */
export async function insertPetUpgrade(tx: TxQuery, playerId: string, taken: InventoryRow, toItemId: string, readyAt: Date) {
    await tx(INSERT_PET_UPGRADE, [
        playerId,
        taken.id,
        taken.item_id,
        toItemId,
        JSON.stringify(taken.pet ?? NEW_PET),
        taken.obtained_at,
        readyAt,
    ]);
}

/** Takes the pet back from Kat (the row goes), or null if there was none. */
export async function takePetUpgrade(tx: TxQuery, playerId: string): Promise<PetUpgradeRow | null> {
    const [row] = await tx<PetUpgradeRow>(DELETE_PET_UPGRADE, [playerId]);
    return row ?? null;
}

/** Health carried between fights, against max health from the player's gear now. */
export async function findHealth(playerId: string, tx: TxQuery = db): Promise<GeoHealth> {
    // One after another: `tx` may be a transaction's single connection.
    const [row] = await tx<HealthAndCampRow>(FIND_HEALTH_AND_CAMP, [playerId]);
    const max = await playerMaxHealth(playerId, tx);
    return { current: currentHealth(row?.health ?? null, max), max };
}

/** Saves health between fights; at or above max it's stored as full. */
export async function setHealth(tx: TxQuery, playerId: string, health: number, max: number) {
    await tx(SET_HEALTH, [playerId, health >= max ? null : Math.max(1, Math.round(health))]);
}

/** The player's camp, or null if none is set (or it was forgotten). */
export async function findCamp(playerId: string, tx: TxQuery = db): Promise<GeoCamp | null> {
    const [row] = await tx<HealthAndCampRow>(FIND_HEALTH_AND_CAMP, [playerId]);
    if (!row || row.camp_latitude === null || row.camp_longitude === null || !row.camp_set_at) return null;
    return {
        position: { latitude: row.camp_latitude, longitude: row.camp_longitude },
        setAt: row.camp_set_at.toISOString(),
        movableAt: campMovableAt(row.camp_set_at).toISOString(),
    };
}

/** When camp was last set, even if it's since been forgotten. */
export async function findCampSetAt(tx: TxQuery, playerId: string): Promise<Date | null> {
    const [row] = await tx<HealthAndCampRow>(FIND_HEALTH_AND_CAMP, [playerId]);
    return row?.camp_set_at ?? null;
}

/** `point` must already be rounded (roundCamp). */
export async function setCamp(tx: TxQuery, playerId: string, point: GeoPoint) {
    await tx(SET_CAMP, [playerId, point.latitude, point.longitude]);
}

export async function clearCamp(tx: TxQuery, playerId: string) {
    await tx(CLEAR_CAMP, [playerId]);
}

/** How many slots the player has unlocked, and what's packed in them. */
export async function findLunchbox(playerId: string, tx: TxQuery = db): Promise<GeoLunchbox> {
    // One after another: `tx` may be a transaction's single connection.
    const [row] = await tx<{ lunchbox_slots: number }>(FIND_LUNCHBOX_SLOTS, [playerId]);
    const contents = await tx<LunchboxRow>(FIND_LUNCHBOX, [playerId]);
    return {
        slots: row?.lunchbox_slots ?? 1,
        contents: contents.filter(isKnownItem).map(
            (entry): GeoLunchboxSlot => ({ slot: entry.slot, itemId: entry.item_id, quantity: entry.quantity }),
        ),
    };
}

/** Puts a stack in a slot, replacing what was there. The caller moves the items. */
export async function setLunchboxSlot(tx: TxQuery, playerId: string, slot: number, itemId: string, quantity: number) {
    await tx(UPSERT_LUNCHBOX_SLOT, [playerId, slot, itemId, quantity]);
}

/**
 * Saves what's left in a slot after eating, from `from` down to `to`; an
 * emptied slot is cleared. Throws unless the slot still holds exactly `from`
 * of that food, so a fight can never eat food that's no longer there: the
 * whole turn, heal included, is undone instead.
 */
export async function eatFromLunchbox(
    tx: TxQuery,
    playerId: string,
    eaten: { slot: number; itemId: string; from: number; to: number },
) {
    const { slot, itemId, from, to } = eaten;
    if (!(to >= 0 && to < from)) throw new Error(`Bad lunchbox change ${from} → ${to}`);
    const [row] =
        to > 0
            ? await tx<{ slot: number }>(EAT_FROM_LUNCHBOX, [playerId, slot, itemId, from, to])
            : await tx<{ slot: number }>(EAT_LAST_FROM_LUNCHBOX, [playerId, slot, itemId, from]);
    if (!row) throw AppError.badRequest("That food is no longer in your lunchbox");
}

export async function clearLunchboxSlot(tx: TxQuery, playerId: string, slot: number) {
    await tx(DELETE_LUNCHBOX_SLOT, [playerId, slot]);
}

/**
 * A packed slot of an item the content no longer has (renamed or removed)
 * counts as empty: the screens can't draw it and nothing can use it, so
 * packing just overwrites it.
 */
function isKnownItem(entry: { item_id: string }): boolean {
    return CONTENT.items[entry.item_id] !== undefined;
}

/** How many bait slots the player has unlocked, and what's packed in them. */
export async function findBait(playerId: string, tx: TxQuery = db): Promise<GeoBait> {
    // One after another: `tx` may be a transaction's single connection.
    const [row] = await tx<{ bait_slots: number }>(FIND_BAIT_SLOTS, [playerId]);
    const contents = await tx<BaitRow>(FIND_BAIT, [playerId]);
    return {
        slots: row?.bait_slots ?? 1,
        contents: contents.filter(isKnownItem).map(
            (entry): GeoBaitSlot => ({ slot: entry.slot, itemId: entry.item_id, quantity: entry.quantity }),
        ),
    };
}

/** Puts a stack in a bait slot, replacing what was there. The caller moves the items. */
export async function setBaitSlot(tx: TxQuery, playerId: string, slot: number, itemId: string, quantity: number) {
    await tx(UPSERT_BAIT_SLOT, [playerId, slot, itemId, quantity]);
}

/**
 * Puts one bait from a slot on the hook; the emptied slot is cleared. Throws
 * unless the slot still holds exactly `from` of that bait, so a cast never
 * uses bait that's no longer there.
 */
export async function useBait(tx: TxQuery, playerId: string, used: { slot: number; itemId: string; from: number }) {
    const { slot, itemId, from } = used;
    const [row] =
        from > 1
            ? await tx<{ slot: number }>(USE_BAIT, [playerId, slot, itemId, from])
            : await tx<{ slot: number }>(USE_LAST_BAIT, [playerId, slot, itemId, from]);
    if (!row) throw AppError.badRequest("That bait is no longer packed");
}

export async function clearBaitSlot(tx: TxQuery, playerId: string, slot: number) {
    await tx(DELETE_BAIT_SLOT, [playerId, slot]);
}

function toSavedHand(row: SavedHandRow): GeoSavedHand {
    return {
        id: row.id,
        skill: row.skill,
        name: row.name,
        inventoryIds: row.inventory_ids,
        createdAt: row.created_at.toISOString(),
    };
}

export async function findSavedHand(
    tx: TxQuery,
    playerId: string,
    savedHandId: string,
): Promise<GeoSavedHand | null> {
    const [row] = await tx<SavedHandRow>(FIND_SAVED_HAND, [playerId, savedHandId]);
    return row ? toSavedHand(row) : null;
}

export async function insertSavedHand(
    tx: TxQuery,
    playerId: string,
    skill: string,
    name: string,
    inventoryIds: string[],
) {
    await tx(INSERT_SAVED_HAND, [playerId, skill, name, inventoryIds]);
}

export async function deleteSavedHand(tx: TxQuery, playerId: string, savedHandId: string) {
    await tx(DELETE_SAVED_HAND, [playerId, savedHandId]);
}

/**
 * Adds items to a player's inventory. Stackable kinds (materials,
 * consumables, misc) join an existing stack; cards arrive with full charges
 * unless `chargesLeft` says otherwise, one row per copy; gear and talismans
 * one row each, keeping `reforge` if given. Returns the new or updated row
 * ids. Unknown item ids throw, so a content typo can't silently drop loot.
 */
export async function grantItems(
    tx: TxQuery,
    playerId: string,
    grants: { itemId: string; quantity: number; chargesLeft?: number; reforge?: string | null; pet?: PetCopy | null }[],
): Promise<string[]> {
    const ids: string[] = [];
    for (const { itemId, quantity, chargesLeft, reforge, pet } of grants) {
        const item = CONTENT.items[itemId];
        if (!item) throw new Error(`Unknown item "${itemId}"`);

        if (isStackable(item)) {
            const [stacked] = await tx<{ id: string }>(ADD_TO_STACK, [playerId, itemId, quantity]);
            if (stacked) {
                ids.push(stacked.id);
                continue;
            }
            const [row] = await tx<InventoryRow>(INSERT_INVENTORY, [playerId, itemId, quantity, null, null, null]);
            if (row) ids.push(row.id);
            continue;
        }

        const charges = item.kind === "card" ? (chargesLeft ?? item.maxCharges) : null;
        // A new pet starts at level 1 with nothing held.
        const copy = item.kind === "pet" ? JSON.stringify(pet ?? NEW_PET) : null;
        for (let i = 0; i < quantity; i++) {
            const [row] = await tx<InventoryRow>(INSERT_INVENTORY, [playerId, itemId, 1, charges, reforge ?? null, copy]);
            if (row) ids.push(row.id);
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

/** Locks one owned row, or null if the player doesn't own it. */
export async function lockInventoryRow(tx: TxQuery, playerId: string, inventoryId: string): Promise<InventoryRow | null> {
    const [row] = await tx<InventoryRow>(LOCK_INVENTORY_ROW, [playerId, inventoryId]);
    return row ?? null;
}

/** Sets one owned copy's reforge. */
export async function setReforge(tx: TxQuery, playerId: string, inventoryId: string, reforgeId: string) {
    const [row] = await tx<{ id: string }>(SET_REFORGE, [playerId, inventoryId, reforgeId]);
    if (!row) throw AppError.notFound("You don't own that item");
}

/** Adds coins (or takes them, with a negative amount) and records why. */
export async function addCoins(tx: TxQuery, playerId: string, amount: number, reason: CoinReason, reference: string) {
    if (amount === 0) return;
    await tx(ADD_COINS, [playerId, amount]);
    await tx(INSERT_COIN_LEDGER, [playerId, amount, reason, reference]);
}

/** Takes every coin the player has and records it. Returns how many. */
export async function loseAllCoins(tx: TxQuery, playerId: string, reason: CoinReason, reference: string): Promise<number> {
    const [row] = await tx<{ lost: string }>(EMPTY_COINS, [playerId]);
    const lost = Number(row?.lost ?? 0);
    if (lost > 0) await tx(INSERT_COIN_LEDGER, [playerId, -lost, reason, reference]);
    return lost;
}

/**
 * Saves a card's charges. Throws if the card has left the player's inventory
 * (sold, listed, crafted away), so a fight can never keep using a card that's
 * gone: the whole turn is undone instead.
 */
export async function setCharges(tx: TxQuery, playerId: string, inventoryId: string, charges: number) {
    const [row] = await tx<{ id: string }>(SET_CHARGES, [playerId, inventoryId, charges]);
    if (!row) throw AppError.badRequest("That card is no longer in your inventory");
}

/** Locks the player row until the transaction ends (see LOCK_PLAYER). */
export async function lockPlayer(tx: TxQuery, playerId: string) {
    await tx(LOCK_PLAYER, [playerId]);
}

export async function equip(tx: TxQuery, playerId: string, slot: string, inventoryId: string) {
    await tx(UNEQUIP_INVENTORY, [playerId, inventoryId]);
    await tx(UPSERT_EQUIPMENT, [playerId, slot, inventoryId]);
}

export async function clearSlot(tx: TxQuery, playerId: string, slot: string) {
    await tx(CLEAR_SLOT, [playerId, slot]);
}

export async function addToTalismanBag(tx: TxQuery, playerId: string, itemId: string, inventoryId: string) {
    await tx(INSERT_TALISMAN_BAG, [playerId, itemId, inventoryId]);
}

export async function removeFromTalismanBag(tx: TxQuery, playerId: string, inventoryId: string) {
    await tx(DELETE_TALISMAN_BAG, [playerId, inventoryId]);
}

export async function setHand(tx: TxQuery, playerId: string, skill: string, inventoryIds: string[]) {
    await tx(UPSERT_HAND, [playerId, skill, inventoryIds]);
}

/** The player's level in every skill they have XP in; others are level 1. */
export async function findSkillLevels(tx: TxQuery, playerId: string): Promise<Record<string, number>> {
    const rows = await tx<SkillXpRow>(FIND_SKILL_XP, [playerId]);
    return Object.fromEntries(rows.map((row) => [row.skill, geoSkillLevel(Number(row.xp))]));
}

/** Adds skill XP, and the active pet's share of it (pets/pets.ts petXpFrom). */
export async function addSkillXp(tx: TxQuery, playerId: string, skill: string, amount: number) {
    if (amount <= 0) return;
    await tx(ADD_SKILL_XP, [playerId, skill, amount]);

    const active = await findActivePet(playerId, tx);
    const found = active ? petOf(active.item_id) : null;
    if (!active || !found) return;
    const gained = petXpFrom(found.pet, skill, amount, active.pet?.heldItem ?? null);
    if (gained > 0) await tx(ADD_PET_XP, [playerId, active.id, gained]);
}

/**
 * Takes `amount` coins, or refuses with "Not enough coins" and takes none.
 * Every purchase goes through here before anything is handed over.
 */
/**
 * Moves coins between the purse and the bank at camp, or refuses with "Not
 * enough coins" and moves none. The ledger records the purse's side.
 */
export async function moveBankCoins(tx: TxQuery, playerId: string, direction: "deposit" | "withdraw", amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Bad coin amount ${amount}`);
    const [row] = await tx<{ coins: string }>(direction === "deposit" ? BANK_DEPOSIT : BANK_WITHDRAW, [playerId, amount]);
    if (!row) throw AppError.badRequest(direction === "deposit" ? "Not enough coins" : "Not enough coins in the bank");
    await tx(INSERT_COIN_LEDGER, [playerId, direction === "deposit" ? -amount : amount, `bank-${direction}`, null]);
}

export async function spendCoins(tx: TxQuery, playerId: string, amount: number, reason: CoinReason, reference: string) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`Bad coin amount ${amount}`);
    if (amount === 0) return;
    const [row] = await tx<{ coins: string }>(SPEND_COINS, [playerId, amount]);
    if (!row) throw AppError.badRequest("Not enough coins");
    await tx(INSERT_COIN_LEDGER, [playerId, -amount, reason, reference]);
}

/**
 * Refuses if the row is worn, in the Talisman Bag, in a hand or the active pet: selling or
 * listing it would pull it out of the player's build without them noticing.
 */
export async function assertNotInUse(tx: TxQuery, playerId: string, inventoryId: string, name: string) {
    const [uses] = await tx<{ equipped: boolean; bagged: boolean; in_hand: boolean; active_pet: boolean }>(FIND_USES, [playerId, inventoryId]);
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
export async function takeItems(tx: TxQuery, playerId: string, itemId: string, quantity: number) {
    const item = CONTENT.items[itemId];
    if (!item) throw new Error(`Unknown item "${itemId}"`);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error(`Bad quantity ${quantity}`);
    const rows = (await tx<InventoryRow>(LOCK_FREE_ROWS_OF_ITEM, [playerId, itemId])).filter(
        (row) => item.kind !== "card" || row.charges_left === item.maxCharges,
    );
    const have = rows.reduce((sum, row) => sum + row.quantity, 0);
    if (have < quantity) throw AppError.badRequest(`You need ${quantity} ${item.name} and have ${have} free`);

    let left = quantity;
    for (const row of rows) {
        if (left === 0) break;
        const taken = Math.min(left, row.quantity);
        if (taken === row.quantity) await tx(DELETE_INVENTORY_ROW, [playerId, row.id]);
        else await tx(TAKE_FROM_STACK, [playerId, row.id, taken]);
        left -= taken;
    }
}

/**
 * Takes `quantity` of an owned row out of the inventory, locked so nothing
 * else can take it at the same time: the whole row when that's all of it,
 * else just that many from the stack. Returns the row as it was, so the copy
 * can be restored or handed on. Refuses an item in use.
 */
export async function takeFromInventory(
    tx: TxQuery,
    playerId: string,
    inventoryId: string,
    quantity: number,
): Promise<InventoryRow> {
    const [row] = await tx<InventoryRow>(LOCK_INVENTORY_ROW, [playerId, inventoryId]);
    if (!row) throw AppError.notFound("You don't own that item");
    const name = CONTENT.items[row.item_id]?.name ?? "that item";
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw AppError.badRequest("Choose at least 1");
    if (quantity > row.quantity) throw AppError.badRequest(`You only have ${row.quantity} ${name}`);
    await assertNotInUse(tx, playerId, inventoryId, name);

    if (quantity === row.quantity) await tx(DELETE_INVENTORY_ROW, [playerId, inventoryId]);
    else await tx(TAKE_FROM_STACK, [playerId, inventoryId, quantity]);
    return row;
}

/**
 * Hands a single copy back as it was (same id and obtained date), e.g. a
 * cancelled listing. A stackable joins the player's stack instead.
 */
export async function restoreItem(
    tx: TxQuery,
    playerId: string,
    copy: {
        inventoryId: string | null;
        itemId: string;
        quantity: number;
        chargesLeft: number | null;
        reforge: string | null;
        pet?: PetCopy | null;
        obtainedAt: Date;
    },
) {
    const item = CONTENT.items[copy.itemId];
    if (!item) throw new Error(`Unknown item "${copy.itemId}"`);
    const grant = { itemId: copy.itemId, chargesLeft: copy.chargesLeft ?? undefined, reforge: copy.reforge, pet: copy.pet };
    if (isStackable(item) || !copy.inventoryId) {
        await grantItems(tx, playerId, [{ ...grant, quantity: copy.quantity }]);
        return;
    }
    const [restored] = await tx<{ id: string }>(RESTORE_INVENTORY_ROW, [
        copy.inventoryId,
        playerId,
        copy.itemId,
        1,
        copy.chargesLeft,
        copy.obtainedAt,
        copy.reforge,
        item.kind === "pet" ? JSON.stringify(copy.pet ?? NEW_PET) : null,
    ]);
    // The id was somehow taken: hand it back as a new copy rather than lose it.
    if (!restored) await grantItems(tx, playerId, [{ ...grant, quantity: 1 }]);
}
