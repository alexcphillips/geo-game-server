import { randomInt } from "node:crypto";
import type { Request, Response } from "express";
import {
    GEO_VENDOR_MAX_QUANTITY,
    type GeoPetUpgradeRequest,
    type GeoVendorBuyRequest,
    type GeoVendorReforgeRequest,
    type GeoVendorSellRequest,
    type GeoVendorsResponse,
} from "@geo/shared";
import { AppError } from "../../http/AppError";
import { CONTENT, reforgesFor, npcBuys, sellValueOf, type VendorDef } from "../../content";
import { priceNow, reforgeCostNow, toVendorView } from "./geo-vendors.rules";
import { withTransaction } from "../../db/transaction";
import { requirePlayerId } from "../../middleware/geo-auth";
import { wholeNumber } from "../../lib/validate";
import * as playerRepository from "../player/geo-player.repository";
import { globalModifiers } from "../../world/global-effects";
import { NEW_PET, petOf, petState } from "../../pets/pets";

function findVendor(req: Request): VendorDef {
    const vendor = CONTENT.vendors[String(req.params.vendorId)];
    if (!vendor) throw AppError.notFound("No such vendor");
    return vendor;
}

function readQuantity(value: unknown): number {
    return wholeNumber(value, 1, GEO_VENDOR_MAX_QUANTITY, AppError.badRequest(`Choose between 1 and ${GEO_VENDOR_MAX_QUANTITY}`));
}

export async function listVendors(_req: Request, res: Response) {
    const modifiers = await globalModifiers();
    const body: GeoVendorsResponse = {
        vendors: Object.values(CONTENT.vendors).map((vendor) => toVendorView(vendor, modifiers)),
    };
    res.status(200).json(body);
}

/**
 * The player buys from a vendor: the coins are taken first, and only then is
 * the item handed over, in one transaction — so either both happen or neither.
 */
export async function buy(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const vendor = findVendor(req);
    const { itemId, quantity } = (req.body ?? {}) as Partial<GeoVendorBuyRequest>;
    const offer = vendor.sells.find((entry) => entry.itemId === itemId);
    if (!offer) throw AppError.badRequest(`The ${vendor.name} doesn't sell that`);
    const units = readQuantity(quantity);

    await withTransaction(async (tx) => {
        const reference = `vendor:${vendor.id}:${offer.itemId}x${units}`;
        const price = priceNow(offer.itemId, offer.price, await globalModifiers(tx));
        await playerRepository.spendCoins(tx, playerId, price * units, "vendor-buy", reference);
        await playerRepository.grantItems(tx, playerId, [{ itemId: offer.itemId, quantity: units }]);
    });

    res.status(200).json(await playerRepository.findMe(playerId));
}

/**
 * The player sells to a vendor: the item leaves the inventory first (locked,
 * so it can't also be listed or sold twice), then the coins are paid.
 */
export async function sell(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const vendor = findVendor(req);
    const { inventoryId, quantity } = (req.body ?? {}) as Partial<GeoVendorSellRequest>;
    if (typeof inventoryId !== "string" || !inventoryId) throw AppError.badRequest("Missing inventoryId");
    const units = readQuantity(quantity);

    await withTransaction(async (tx) => {
        const [owned] = await playerRepository.findInventoryByIds(playerId, [inventoryId], tx);
        if (!owned) throw AppError.notFound("You don't own that item");
        const item = CONTENT.items[owned.item_id];
        if (!item || !npcBuys(item)) throw AppError.badRequest("Vendors don't buy that");
        if (item.kind === "card" && owned.charges_left !== item.maxCharges) {
            throw AppError.badRequest("Only cards at full charge can be sold");
        }

        const taken = await playerRepository.takeFromInventory(tx, playerId, inventoryId, units);
        // Again on the locked row: a turn could have spent a charge since the read above.
        if (item.kind === "card" && taken.charges_left !== item.maxCharges) {
            throw AppError.badRequest("Only cards at full charge can be sold");
        }
        const reference = `vendor:${vendor.id}:${taken.item_id}x${units}`;
        await playerRepository.addCoins(tx, playerId, sellValueOf(item) * units, "vendor-sell", reference);
    });

    res.status(200).json(await playerRepository.findMe(playerId));
}

/**
 * The player pays a vendor to reroll one weapon or armor copy's reforge: a
 * random one that fits the item, never the one it has. Worn gear can be
 * reforged in place. The copy is locked, so two rerolls can't cross.
 */
export async function reforge(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const vendor = findVendor(req);
    const { inventoryId } = (req.body ?? {}) as Partial<GeoVendorReforgeRequest>;
    if (!vendor.reforge) throw AppError.badRequest(`The ${vendor.name} doesn't reforge`);
    if (typeof inventoryId !== "string" || !inventoryId) throw AppError.badRequest("Missing inventoryId");
    const costs = vendor.reforge.cost;

    await withTransaction(async (tx) => {
        const owned = await playerRepository.lockInventoryRow(tx, playerId, inventoryId);
        if (!owned) throw AppError.notFound("You don't own that item");
        const item = CONTENT.items[owned.item_id];
        const choices = reforgesFor(CONTENT, item).filter((candidate) => candidate.id !== owned.reforge);
        if (!item || choices.length === 0) throw AppError.badRequest("Only weapons and armor can be reforged");

        const picked = choices[randomInt(choices.length)]!;
        const cost = reforgeCostNow(costs, item.rarity, await globalModifiers(tx));
        await playerRepository.spendCoins(tx, playerId, cost, "vendor-reforge", `vendor:${vendor.id}:reforge:${owned.id}`);
        await playerRepository.setReforge(tx, playerId, owned.id, picked.id);
    });

    res.status(200).json(await playerRepository.findMe(playerId));
}

/**
 * Leaves a pet with Kat to raise it one rarity, paying her price now (coins
 * and materials, less a little per level). The pet leaves the inventory,
 * XP and held item intact, until it's collected. One pet at a time.
 */
export async function upgradePet(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const vendor = findVendor(req);
    const { inventoryId } = (req.body ?? {}) as Partial<GeoPetUpgradeRequest>;
    if (!vendor.petUpgrades) throw AppError.badRequest(`The ${vendor.name} doesn't raise pets`);
    if (typeof inventoryId !== "string" || !inventoryId) throw AppError.badRequest("Missing inventoryId");

    await withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        if (await playerRepository.findPetUpgrade(playerId, tx)) throw AppError.badRequest(`${vendor.name} is already looking after a pet`);

        const owned = await playerRepository.lockInventoryRow(tx, playerId, inventoryId);
        if (!owned || !petOf(owned.item_id)) throw AppError.notFound("You don't own that pet");
        const quote = petState(owned.item_id, owned.pet ?? NEW_PET)?.upgrade;
        if (!quote) throw AppError.badRequest("That pet can't go any higher");

        const reference = `vendor:${vendor.id}:pet-upgrade:${owned.id}`;
        await playerRepository.spendCoins(tx, playerId, quote.coins, "pet-upgrade", reference);
        for (const { itemId, quantity } of quote.items) await playerRepository.takeItems(tx, playerId, itemId, quantity);
        const taken = await playerRepository.takeFromInventory(tx, playerId, owned.id, 1);
        await playerRepository.insertPetUpgrade(tx, playerId, taken, quote.toItemId, new Date(Date.now() + quote.hours * 3_600_000));
    });

    res.status(200).json(await playerRepository.findMe(playerId));
}

/** Takes the pet back from Kat once it's ready: the same copy, one rarity higher. */
export async function collectPetUpgrade(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const vendor = findVendor(req);
    if (!vendor.petUpgrades) throw AppError.badRequest(`The ${vendor.name} doesn't raise pets`);

    await withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        const waiting = await playerRepository.findPetUpgrade(playerId, tx);
        if (!waiting) throw AppError.badRequest(`${vendor.name} isn't looking after a pet of yours`);
        if (waiting.ready_at.getTime() > Date.now()) throw AppError.badRequest("It isn't ready yet");

        await playerRepository.takePetUpgrade(tx, playerId);
        // A rarity since removed from the content comes back as it went in.
        const itemId = CONTENT.items[waiting.to_item_id] ? waiting.to_item_id : waiting.item_id;
        await playerRepository.restoreItem(tx, playerId, {
            inventoryId: waiting.inventory_id,
            itemId,
            quantity: 1,
            chargesLeft: null,
            reforge: null,
            pet: waiting.pet,
            obtainedAt: waiting.obtained_at,
        });
    });

    res.status(200).json(await playerRepository.findMe(playerId));
}
