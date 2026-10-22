import type { Request, Response } from "express";
import type { GeoPetItemRequest, GeoSetActivePetRequest } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { CONTENT, GAME_CONFIG } from "../../content";
import { withTransaction, type TxQuery } from "../../db/transaction";
import { requirePlayerId } from "../../middleware/geo-auth";
import { petOf } from "../../pets/pets";
import * as playerRepository from "./geo-player.repository";
import { syncActiveLoadout } from "../wardrobe/geo-wardrobe.repository";
import type { InventoryRow } from "./geo-player.types";

/**
 * The player's pets: which one is active, and what each holds. Kat's rarity
 * upgrades are a vendor's (`vendors/geo-vendors.controller.ts`).
 */

/** Locks an owned pet copy, or refuses. */
async function lockPet(tx: TxQuery, playerId: string, inventoryId: string): Promise<InventoryRow> {
    const row = await playerRepository.lockInventoryRow(tx, playerId, inventoryId);
    if (!row) throw AppError.notFound("You don't own that pet");
    if (!petOf(row.item_id)) throw AppError.badRequest("That isn't a pet");
    return row;
}

/** `PUT /geo/me/pet`: one pet active at a time; null puts it away. */
export async function setActivePet(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const { inventoryId } = (req.body ?? {}) as Partial<GeoSetActivePetRequest>;
    if (inventoryId !== null && typeof inventoryId !== "string") throw AppError.badRequest("inventoryId must be a string or null");

    await withTransaction(async (tx) => {
        if (inventoryId) await lockPet(tx, playerId, inventoryId);
        await playerRepository.setActivePet(tx, playerId, inventoryId);
        // The active loadout keeps its pet in step.
        await syncActiveLoadout(tx, playerId);
    });

    res.status(200).json(await playerRepository.findMe(playerId));
}

/**
 * `PUT /geo/me/pets/:inventoryId/item`: the pet holds one of a stack of pet
 * items, used up. Whatever it held before comes back to the inventory.
 */
export async function givePetItem(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const petId = String(req.params.inventoryId);
    const { inventoryId: heldRowId } = (req.body ?? {}) as Partial<GeoPetItemRequest>;
    if (typeof heldRowId !== "string" || !heldRowId) throw AppError.badRequest("Missing inventoryId");

    await withTransaction(async (tx) => {
        const pet = await lockPet(tx, playerId, petId);
        const [heldRow] = await playerRepository.findInventoryByIds(playerId, [heldRowId], tx);
        const held = heldRow ? CONTENT.items[heldRow.item_id] : undefined;
        if (!heldRow || held?.kind !== "petItem") throw AppError.badRequest("Pets can only hold pet items");

        await playerRepository.takeFromInventory(tx, playerId, heldRowId, 1);
        const previous = pet.pet?.heldItem;
        if (previous && CONTENT.items[previous]) await playerRepository.grantItems(tx, playerId, [{ itemId: previous, quantity: 1 }]);
        await playerRepository.setPetHeldItem(tx, playerId, petId, held.id);
    });

    res.status(200).json(await playerRepository.findMe(playerId));
}

/** `DELETE /geo/me/pets/:inventoryId/item`: the held item comes back, for coins by its rarity. */
export async function takePetItem(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const petId = String(req.params.inventoryId);

    await withTransaction(async (tx) => {
        const pet = await lockPet(tx, playerId, petId);
        const heldId = pet.pet?.heldItem;
        if (!heldId) throw AppError.badRequest("That pet isn't holding anything");
        const held = CONTENT.items[heldId];
        // A held item since removed from the content is just cleared, free.
        if (held) {
            const cost = GAME_CONFIG.pets.heldItemRemovalCost[held.rarity];
            await playerRepository.spendCoins(tx, playerId, cost, "pet-item-removal", `pet:${petId}:${heldId}`);
            await playerRepository.grantItems(tx, playerId, [{ itemId: heldId, quantity: 1 }]);
        }
        await playerRepository.setPetHeldItem(tx, playerId, petId, null);
    });

    res.status(200).json(await playerRepository.findMe(playerId));
}
