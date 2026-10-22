import type { Context } from "hono";
import {
    GEO_BAIT_MAX_SLOTS,
    GEO_BAIT_STACK_SIZE,
    GEO_CAMP_MOVE_DAYS,
    GEO_EQUIPMENT_SLOTS,
    GEO_HAND_SIZE,
    GEO_LUNCHBOX_MAX_SLOTS,
    GEO_LUNCHBOX_STACK_SIZE,
    GEO_TALISMAN_BAG_FULL,
    GEO_TALISMAN_BAG_PAGE_SIZE,
    geoSkillName,
    geoSlotKind,
    geoUnmetSkill,
    isValidPoint,
    type GeoBankRequest,
    type GeoEquipmentSlot,
    type GeoEquipRequest,
    type GeoPackBaitRequest,
    type GeoPackLunchboxRequest,
    type GeoPoint,
    type GeoSaveHandRequest,
    type GeoSetHandRequest,
} from "@geo/shared";
import { CONTENT } from "../../../../server/src/content";
import { AppError } from "../../../../server/src/http/AppError";
import { campMovableAt, isAtCamp, roundCamp } from "../../../../server/src/modules/player/geo-camp.rules";
import type { AppEnv } from "../../app";
import type { Db } from "../../db/db";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as runsRepository from "../runs/runs.repository";
import { syncActiveLoadout } from "../wardrobe/wardrobe.repository";
import * as playerRepository from "./player.repository";

/**
 * The signed-in player's own state, from server/src/modules/player/geo-player.controller.ts.
 * Each change runs in one synchronous transaction and replies with the whole
 * player, read after it commits.
 */

type Ctx = Context<AppEnv>;

/** Runs `work` for the signed-in player in one transaction, then replies with `findMe`. */
export function changeMe(c: Ctx, work: (db: Db, playerId: string) => void, status: 200 | 201 = 200) {
    const playerId = requirePlayerId(c);
    const { db } = c.var.world;
    db.transaction(() => work(db, playerId));
    return c.json(playerRepository.requireMe(db, playerId), status);
}

export function getMe(c: Ctx) {
    return c.json(playerRepository.requireMe(c.var.world.db, requirePlayerId(c)), 200);
}

/** Puts an owned piece of equipment in a slot, or empties the slot. The active loadout follows. */
export async function setEquipment(c: Ctx) {
    const slot = c.req.param("slot") as GeoEquipmentSlot;
    if (!GEO_EQUIPMENT_SLOTS.includes(slot)) throw AppError.badRequest("Unknown slot");
    const { inventoryId } = (await jsonBody(c)) as Partial<GeoEquipRequest>;

    return changeMe(c, (db, playerId) => {
        if (inventoryId === null || inventoryId === undefined) {
            playerRepository.clearSlot(db, playerId, slot);
        } else {
            if (typeof inventoryId !== "string") throw AppError.badRequest("inventoryId must be a string or null");
            const row = playerRepository.findInventoryRow(db, playerId, inventoryId);
            if (!row) throw AppError.notFound("You don't own that item");

            const item = CONTENT.items[row.item_id];
            if (item?.kind !== "equipment") throw AppError.badRequest("That item can't be equipped");
            if (item.slot !== geoSlotKind(slot)) throw AppError.badRequest(`That goes in a ${item.slot} slot`);
            const unmet = geoUnmetSkill(playerRepository.findSkillLevels(db, playerId), item.skills);
            if (unmet) throw AppError.badRequest(`Needs ${geoSkillName(unmet.skill)} level ${unmet.level} to equip`);

            playerRepository.equip(db, playerId, slot, inventoryId);
        }
        syncActiveLoadout(db, playerId);
    });
}

/**
 * Puts an owned talisman in the bag, unless a copy of it is already there or
 * every page is full. Taking one out leaves it in the inventory.
 */
export function addToTalismanBag(c: Ctx) {
    const inventoryId = c.req.param("inventoryId") ?? "";
    return changeMe(c, (db, playerId) => {
        const row = playerRepository.findInventoryRow(db, playerId, inventoryId);
        if (!row) throw AppError.notFound("You don't own that item");
        const item = CONTENT.items[row.item_id];
        if (item?.kind !== "talisman") throw AppError.badRequest("Only talismans go in the Talisman Bag");

        const pages = playerRepository.findTalismanBagPages(db, playerId);
        const bag = playerRepository.findTalismanBag(db, playerId);
        if (bag.some((entry) => entry.inventory_id === inventoryId)) return;
        if (bag.some((entry) => entry.item_id === row.item_id)) throw AppError.badRequest(`Your bag already has a ${item.name}`);
        if (bag.length >= pages * GEO_TALISMAN_BAG_PAGE_SIZE) throw AppError.badRequest(GEO_TALISMAN_BAG_FULL);
        playerRepository.addToTalismanBag(db, playerId, row.item_id, inventoryId);
    });
}

export function removeFromTalismanBag(c: Ctx) {
    const inventoryId = c.req.param("inventoryId") ?? "";
    return changeMe(c, (db, playerId) => playerRepository.removeFromTalismanBag(db, playerId, inventoryId));
}

/** Most saved hands a player keeps per skill. PLACEHOLDER. */
const MAX_SAVED_HANDS_PER_SKILL = 10;

/**
 * The deck rules, checked here so the app can't be talked past them: only
 * that skill's cards, none faded, no two copies of the same card, at most
 * GEO_HAND_SIZE. Throws the first rule broken.
 */
function assertValidHand(db: Db, playerId: string, skill: string, inventoryIds: string[]) {
    if (inventoryIds.length > GEO_HAND_SIZE) throw AppError.badRequest(`A hand holds ${GEO_HAND_SIZE} cards`);
    if (new Set(inventoryIds).size !== inventoryIds.length) throw AppError.badRequest("A card is listed twice");

    const rows = playerRepository.findInventoryByIds(db, playerId, inventoryIds);
    if (rows.length !== inventoryIds.length) throw AppError.notFound("You don't own one of those cards");

    const cardIds = new Set<string>();
    for (const row of rows) {
        const item = CONTENT.items[row.item_id];
        if (item?.kind !== "card") throw AppError.badRequest("Only cards go in a hand");
        const card = CONTENT.cards[item.cardId];
        if (card?.skill !== skill) throw AppError.badRequest(`${item.name} isn't a ${skill} card`);
        if ((row.charges_left ?? 0) <= 0) throw AppError.badRequest(`${item.name} has faded`);
        if (cardIds.has(item.cardId)) throw AppError.badRequest(`Only one ${item.name} per hand`);
        cardIds.add(item.cardId);
    }
}

function parseIds(value: unknown): string[] {
    if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) {
        throw AppError.badRequest("inventoryIds must be a list of ids");
    }
    return value;
}

export async function setHand(c: Ctx) {
    const skill = c.req.param("skill") ?? "";
    const inventoryIds = parseIds(((await jsonBody(c)) as Partial<GeoSetHandRequest>).inventoryIds);
    return changeMe(c, (db, playerId) => {
        runsRepository.assertHandNotInRun(db, playerId, skill);
        assertValidHand(db, playerId, skill, inventoryIds);
        playerRepository.setHand(db, playerId, skill, inventoryIds);
    });
}

/** Saves a skill's current hand under a name. */
export async function saveHand(c: Ctx) {
    const { skill, name } = (await jsonBody(c)) as Partial<GeoSaveHandRequest>;
    if (typeof skill !== "string" || !skill) throw AppError.badRequest("Missing skill");
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed || trimmed.length > 40) throw AppError.badRequest("A name of 1–40 characters");

    return changeMe(
        c,
        (db, playerId) => {
            if (playerRepository.countSavedHands(db, playerId, skill) >= MAX_SAVED_HANDS_PER_SKILL) {
                throw AppError.badRequest(`At most ${MAX_SAVED_HANDS_PER_SKILL} saved hands per skill`);
            }
            const current = playerRepository.findHand(db, playerId, skill);
            if (current.length === 0) throw AppError.badRequest("That hand is empty");
            playerRepository.insertSavedHand(db, playerId, skill, trimmed, current);
        },
        201,
    );
}

/**
 * Makes a saved hand the current one. Cards that have since faded or left the
 * inventory are dropped rather than refusing the whole hand.
 */
export function loadSavedHand(c: Ctx) {
    const savedHandId = c.req.param("savedHandId") ?? "";
    return changeMe(c, (db, playerId) => {
        const saved = playerRepository.findSavedHand(db, playerId, savedHandId);
        if (!saved) throw AppError.notFound("Saved hand not found");
        runsRepository.assertHandNotInRun(db, playerId, saved.skill);

        const rows = playerRepository.findInventoryByIds(db, playerId, saved.inventoryIds);
        const usable = saved.inventoryIds.filter((id) => (rows.find((row) => row.id === id)?.charges_left ?? 0) > 0);
        assertValidHand(db, playerId, saved.skill, usable);
        playerRepository.setHand(db, playerId, saved.skill, usable);
    });
}

export function deleteSavedHand(c: Ctx) {
    const savedHandId = c.req.param("savedHandId") ?? "";
    return changeMe(c, (db, playerId) => playerRepository.deleteSavedHand(db, playerId, savedHandId));
}

/** The `:slot` param as a lunchbox or bait slot index, or a 400. */
function parseSlot(c: Ctx, max: number, what: string): number {
    const slot = Number(c.req.param("slot"));
    if (!Number.isInteger(slot) || slot < 0 || slot >= max) throw AppError.badRequest(`Unknown ${what} slot`);
    return slot;
}

/** Puts back whatever is packed in a lunchbox slot, so it can be refilled or left empty. */
function unpackLunchboxSlot(db: Db, playerId: string, slot: number) {
    const packed = playerRepository.findLunchbox(db, playerId).contents.find((entry) => entry.slot === slot);
    if (!packed) return;
    playerRepository.grantItems(db, playerId, [{ itemId: packed.itemId, quantity: packed.quantity }]);
    playerRepository.clearLunchboxSlot(db, playerId, slot);
}

/** The body's `position`, or a 400. The phone's word, like a spawn fight's. */
function parsePosition(body: Record<string, unknown>): GeoPoint {
    if (!isValidPoint(body.position)) throw AppError.badRequest("position is required");
    return body.position;
}

/**
 * Refuses unless the player is at camp: restocking happens there and
 * nowhere else. Game admins skip it, as they do a dungeon's POI check.
 */
function assertAtCamp(c: Ctx, db: Db, playerId: string, position: GeoPoint, doing: string) {
    if (c.var.role === "admin") return;
    const camp = playerRepository.findCamp(db, playerId);
    if (!camp) throw AppError.badRequest(`Set a camp first: you can only ${doing} there`);
    if (!isAtCamp(position, camp.position)) throw AppError.badRequest(`You can only ${doing} at camp`);
}

/**
 * Packs food into a lunchbox slot: whatever the slot held goes back to the
 * inventory, then `quantity` of the food leaves it. One food per slot, and
 * no food in two slots. At camp only, and not mid-Run.
 */
export async function packLunchbox(c: Ctx) {
    const slot = parseSlot(c, GEO_LUNCHBOX_MAX_SLOTS, "lunchbox");
    const body = await jsonBody(c);
    const { itemId, quantity } = body as Partial<GeoPackLunchboxRequest>;
    const position = parsePosition(body);
    if (typeof itemId !== "string") throw AppError.badRequest("Missing itemId");
    if (!Number.isInteger(quantity) || quantity! < 1 || quantity! > GEO_LUNCHBOX_STACK_SIZE) {
        throw AppError.badRequest(`A lunchbox slot holds 1–${GEO_LUNCHBOX_STACK_SIZE}`);
    }
    const item = CONTENT.items[itemId];
    if (item?.kind !== "consumable" || !item.food) throw AppError.badRequest("Only food goes in the lunchbox");

    return changeMe(c, (db, playerId) => {
        runsRepository.assertNotInRun(db, playerId, "You can't repack your lunchbox mid-Run");
        assertAtCamp(c, db, playerId, position, "pack your lunchbox");

        const lunchbox = playerRepository.findLunchbox(db, playerId);
        if (slot >= lunchbox.slots) throw AppError.badRequest("That lunchbox slot is still locked");
        if (lunchbox.contents.some((entry) => entry.itemId === itemId && entry.slot !== slot)) {
            throw AppError.badRequest(`${item.name} is already in another slot`);
        }
        unpackLunchboxSlot(db, playerId, slot);
        playerRepository.takeItems(db, playerId, itemId, quantity!);
        playerRepository.setLunchboxSlot(db, playerId, slot, itemId, quantity!);
    });
}

/** Empties a lunchbox slot back into the inventory. */
export function unpackLunchbox(c: Ctx) {
    const slot = parseSlot(c, GEO_LUNCHBOX_MAX_SLOTS, "lunchbox");
    return changeMe(c, (db, playerId) => {
        runsRepository.assertNotInRun(db, playerId, "You can't repack your lunchbox mid-Run");
        unpackLunchboxSlot(db, playerId, slot);
    });
}

/**
 * Eats one food from a lunchbox slot between fights. Works anywhere (only
 * packing is camp-only), so the lunchbox is all the food a player has while
 * away. Only its effect on health counts (heals, or harm that stops at 1);
 * buffs and statuses only work in a fight. Not mid-Run: the fight eats as a turn.
 */
export function eatLunchbox(c: Ctx) {
    const slot = parseSlot(c, GEO_LUNCHBOX_MAX_SLOTS, "lunchbox");
    return changeMe(c, (db, playerId) => {
        runsRepository.assertNotInRun(db, playerId, "Eat as your turn in the fight");
        runsRepository.eatBetweenFightsFor(c.var.world, playerId, slot);
    });
}

/** Puts back whatever bait is packed in a slot. */
function unpackBaitSlot(db: Db, playerId: string, slot: number) {
    const packed = playerRepository.findBait(db, playerId).contents.find((entry) => entry.slot === slot);
    if (!packed) return;
    playerRepository.grantItems(db, playerId, [{ itemId: packed.itemId, quantity: packed.quantity }]);
    playerRepository.clearBaitSlot(db, playerId, slot);
}

/**
 * Packs bait into a bait slot, the same way as the lunchbox. At camp only.
 * No combat Run uses bait, so there's no mid-Run lock.
 */
export async function packBait(c: Ctx) {
    const slot = parseSlot(c, GEO_BAIT_MAX_SLOTS, "bait");
    const body = await jsonBody(c);
    const { itemId, quantity } = body as Partial<GeoPackBaitRequest>;
    const position = parsePosition(body);
    if (typeof itemId !== "string") throw AppError.badRequest("Missing itemId");
    if (!Number.isInteger(quantity) || quantity! < 1 || quantity! > GEO_BAIT_STACK_SIZE) {
        throw AppError.badRequest(`A bait slot holds 1–${GEO_BAIT_STACK_SIZE}`);
    }
    const item = CONTENT.items[itemId];
    if (item?.kind !== "consumable" || !item.bait) throw AppError.badRequest("Only bait goes in the bait slots");

    return changeMe(c, (db, playerId) => {
        assertAtCamp(c, db, playerId, position, "pack bait");
        const bait = playerRepository.findBait(db, playerId);
        if (slot >= bait.slots) throw AppError.badRequest("That bait slot is still locked");
        if (bait.contents.some((entry) => entry.itemId === itemId && entry.slot !== slot)) {
            throw AppError.badRequest(`${item.name} is already in another slot`);
        }
        unpackBaitSlot(db, playerId, slot);
        playerRepository.takeItems(db, playerId, itemId, quantity!);
        playerRepository.setBaitSlot(db, playerId, slot, itemId, quantity!);
    });
}

export function unpackBait(c: Ctx) {
    const slot = parseSlot(c, GEO_BAIT_MAX_SLOTS, "bait");
    return changeMe(c, (db, playerId) => unpackBaitSlot(db, playerId, slot));
}

/**
 * Sets camp to (about) where the player stands: rounded before it's stored,
 * so the exact point is never kept. Once every GEO_CAMP_MOVE_DAYS.
 */
export async function setCamp(c: Ctx) {
    const position = parsePosition(await jsonBody(c));
    return changeMe(c, (db, playerId) => {
        const movableAt = campMovableAt(playerRepository.findCampSetAt(db, playerId));
        if (movableAt.getTime() > Date.now() && c.var.role !== "admin") {
            throw AppError.badRequest(`Camp can be moved once every ${GEO_CAMP_MOVE_DAYS} days`);
        }
        playerRepository.setCamp(db, playerId, roundCamp(position));
    });
}

/** Forgets camp. Setting a new one still waits out the days since the last. */
export function clearCamp(c: Ctx) {
    return changeMe(c, (db, playerId) => playerRepository.clearCamp(db, playerId));
}

export const bankDeposit = (c: Ctx) => moveBankCoins(c, "deposit");
export const bankWithdraw = (c: Ctx) => moveBankCoins(c, "withdraw");

/**
 * Moves coins between the purse and the bank. At camp only, and not mid-Run:
 * a defeat takes the purse, so banking mid-fight would dodge it.
 */
async function moveBankCoins(c: Ctx, direction: "deposit" | "withdraw") {
    const body = await jsonBody(c);
    const { amount } = body as Partial<GeoBankRequest>;
    const position = parsePosition(body);
    if (!Number.isSafeInteger(amount) || amount! < 1) throw AppError.badRequest("amount must be a whole number of coins, 1 or more");

    return changeMe(c, (db, playerId) => {
        runsRepository.assertNotInRun(db, playerId, "You can't use the bank mid-Run");
        assertAtCamp(c, db, playerId, position, "use the bank");
        playerRepository.moveBankCoins(db, playerId, direction, amount!);
    });
}
