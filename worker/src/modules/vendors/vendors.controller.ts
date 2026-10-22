import { randomInt } from "node:crypto";
import type { Context } from "hono";
import {
    GEO_VENDOR_MAX_QUANTITY,
    type GeoPetUpgradeRequest,
    type GeoVendorBuyRequest,
    type GeoVendorReforgeRequest,
    type GeoVendorSellRequest,
    type GeoVendorsResponse,
} from "@geo/shared";
import { CONTENT, npcBuys, reforgesFor, sellValueOf, type VendorDef } from "../../../../server/src/content";
import { AppError } from "../../../../server/src/http/AppError";
import { wholeNumber } from "../../../../server/src/lib/validate";
import { priceNow, reforgeCostNow, toVendorView } from "../../../../server/src/modules/vendors/geo-vendors.rules";
import { NEW_PET, petOf, petState, type PetCopy } from "../../../../server/src/pets/pets";
import type { AppEnv } from "../../app";
import { jsonBody } from "../../http/body";
import { globalModifiers } from "../mayor/mayor.repository";
import { changeMe } from "../player/player.controller";
import * as playerRepository from "../player/player.repository";

/**
 * NPC vendors, from server/src/modules/vendors/geo-vendors.controller.ts
 * (whose price rules this uses). Each trade is one transaction that takes
 * first (coins, the item) and hands over after, and replies with the player.
 */

type Ctx = Context<AppEnv>;

function findVendor(c: Ctx): VendorDef {
    const vendor = CONTENT.vendors[c.req.param("vendorId") ?? ""];
    if (!vendor) throw AppError.notFound("No such vendor");
    return vendor;
}

const readQuantity = (value: unknown) =>
    wholeNumber(value, 1, GEO_VENDOR_MAX_QUANTITY, AppError.badRequest(`Choose between 1 and ${GEO_VENDOR_MAX_QUANTITY}`));

export function listVendors(c: Ctx) {
    const modifiers = globalModifiers(c.var.world.db);
    const body: GeoVendorsResponse = { vendors: Object.values(CONTENT.vendors).map((vendor) => toVendorView(vendor, modifiers)) };
    return c.json(body, 200);
}

/** The player buys from a vendor: the coins are taken first, then the item handed over. */
export async function buy(c: Ctx) {
    const vendor = findVendor(c);
    const { itemId, quantity } = (await jsonBody(c)) as Partial<GeoVendorBuyRequest>;
    const offer = vendor.sells.find((entry) => entry.itemId === itemId);
    if (!offer) throw AppError.badRequest(`The ${vendor.name} doesn't sell that`);
    const units = readQuantity(quantity);

    return changeMe(c, (db, playerId) => {
        const price = priceNow(offer.itemId, offer.price, globalModifiers(db));
        playerRepository.spendCoins(db, playerId, price * units, "vendor-buy", `vendor:${vendor.id}:${offer.itemId}x${units}`);
        playerRepository.grantItems(db, playerId, [{ itemId: offer.itemId, quantity: units }]);
    });
}

/** The player sells to a vendor: the item leaves the inventory first, then the coins are paid. */
export async function sell(c: Ctx) {
    const vendor = findVendor(c);
    const { inventoryId, quantity } = (await jsonBody(c)) as Partial<GeoVendorSellRequest>;
    if (typeof inventoryId !== "string" || !inventoryId) throw AppError.badRequest("Missing inventoryId");
    const units = readQuantity(quantity);

    return changeMe(c, (db, playerId) => {
        const owned = playerRepository.findInventoryRow(db, playerId, inventoryId);
        if (!owned) throw AppError.notFound("You don't own that item");
        const item = CONTENT.items[owned.item_id];
        if (!item || !npcBuys(item)) throw AppError.badRequest("Vendors don't buy that");
        if (item.kind === "card" && owned.charges_left !== item.maxCharges) throw AppError.badRequest("Only cards at full charge can be sold");

        playerRepository.takeFromInventory(db, playerId, inventoryId, units);
        const reference = `vendor:${vendor.id}:${owned.item_id}x${units}`;
        playerRepository.addCoins(db, playerId, sellValueOf(item) * units, "vendor-sell", reference);
    });
}

/**
 * The player pays a vendor to reroll one weapon or armor copy's reforge: a
 * random one that fits the item, never the one it has. Worn gear can be
 * reforged in place.
 */
export async function reforge(c: Ctx) {
    const vendor = findVendor(c);
    const { inventoryId } = (await jsonBody(c)) as Partial<GeoVendorReforgeRequest>;
    const reforging = vendor.reforge;
    if (!reforging) throw AppError.badRequest(`The ${vendor.name} doesn't reforge`);
    if (typeof inventoryId !== "string" || !inventoryId) throw AppError.badRequest("Missing inventoryId");

    return changeMe(c, (db, playerId) => {
        const owned = playerRepository.findInventoryRow(db, playerId, inventoryId);
        if (!owned) throw AppError.notFound("You don't own that item");
        const item = CONTENT.items[owned.item_id];
        const choices = reforgesFor(CONTENT, item).filter((candidate) => candidate.id !== owned.reforge);
        if (!item || choices.length === 0) throw AppError.badRequest("Only weapons and armor can be reforged");

        const picked = choices[randomInt(choices.length)]!;
        const cost = reforgeCostNow(reforging.cost, item.rarity, globalModifiers(db));
        playerRepository.spendCoins(db, playerId, cost, "vendor-reforge", `vendor:${vendor.id}:reforge:${owned.id}`);
        playerRepository.setReforge(db, playerId, owned.id, picked.id);
    });
}

/**
 * Leaves a pet with Kat to raise it one rarity, paying her price now (coins
 * and materials, less a little per level). The pet leaves the inventory,
 * XP and held item intact, until it's collected. One pet at a time.
 */
export async function upgradePet(c: Ctx) {
    const vendor = findVendor(c);
    const { inventoryId } = (await jsonBody(c)) as Partial<GeoPetUpgradeRequest>;
    if (!vendor.petUpgrades) throw AppError.badRequest(`The ${vendor.name} doesn't raise pets`);
    if (typeof inventoryId !== "string" || !inventoryId) throw AppError.badRequest("Missing inventoryId");

    return changeMe(c, (db, playerId) => {
        if (playerRepository.findPetUpgrade(db, playerId)) throw AppError.badRequest(`${vendor.name} is already looking after a pet`);
        const owned = playerRepository.findInventoryRow(db, playerId, inventoryId);
        if (!owned || !petOf(owned.item_id)) throw AppError.notFound("You don't own that pet");
        const quote = petState(owned.item_id, owned.pet ?? NEW_PET)?.upgrade;
        if (!quote) throw AppError.badRequest("That pet can't go any higher");

        playerRepository.spendCoins(db, playerId, quote.coins, "pet-upgrade", `vendor:${vendor.id}:pet-upgrade:${owned.id}`);
        for (const { itemId, quantity } of quote.items) playerRepository.takeItems(db, playerId, itemId, quantity);
        const taken = playerRepository.takeFromInventory(db, playerId, owned.id, 1);
        playerRepository.insertPetUpgrade(db, playerId, taken, quote.toItemId, Date.now() + quote.hours * 3_600_000);
    });
}

/** Takes the pet back from Kat once it's ready: the same copy, one rarity higher. */
export function collectPetUpgrade(c: Ctx) {
    const vendor = findVendor(c);
    if (!vendor.petUpgrades) throw AppError.badRequest(`The ${vendor.name} doesn't raise pets`);

    return changeMe(c, (db, playerId) => {
        const waiting = playerRepository.findPetUpgrade(db, playerId);
        if (!waiting) throw AppError.badRequest(`${vendor.name} isn't looking after a pet of yours`);
        if (waiting.ready_at > Date.now()) throw AppError.badRequest("It isn't ready yet");

        playerRepository.takePetUpgrade(db, playerId);
        // A rarity since removed from the content comes back as it went in.
        const itemId = CONTENT.items[waiting.to_item_id] ? waiting.to_item_id : waiting.item_id;
        playerRepository.restoreItem(db, playerId, {
            inventoryId: waiting.inventory_id,
            itemId,
            quantity: 1,
            chargesLeft: null,
            reforge: null,
            pet: JSON.parse(waiting.pet) as PetCopy,
            obtainedAt: waiting.obtained_at,
        });
    });
}
