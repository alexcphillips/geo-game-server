import type { Context } from "hono";
import type { GeoPetItemRequest, GeoSetActivePetRequest } from "@geo/shared";
import { CONTENT, GAME_CONFIG } from "../../../../server/src/content";
import { AppError } from "../../../../server/src/http/AppError";
import { petOf } from "../../../../server/src/pets/pets";
import type { AppEnv } from "../../app";
import type { Db } from "../../db/db";
import { jsonBody } from "../../http/body";
import { syncActiveLoadout } from "../wardrobe/wardrobe.repository";
import { changeMe } from "./player.controller";
import * as playerRepository from "./player.repository";
import type { InventoryRow } from "./player.types";

/**
 * The player's pets: which one is active, and what each holds, from
 * server/src/modules/player/geo-pets.controller.ts. Kat's rarity upgrades
 * are a vendor's (session 4).
 */

type Ctx = Context<AppEnv>;

/** An owned pet copy, or refused. */
function findPet(db: Db, playerId: string, inventoryId: string): InventoryRow {
    const row = playerRepository.findInventoryRow(db, playerId, inventoryId);
    if (!row) throw AppError.notFound("You don't own that pet");
    if (!petOf(row.item_id)) throw AppError.badRequest("That isn't a pet");
    return row;
}

/** `PUT /geo/me/pet`: one pet active at a time; null puts it away. */
export async function setActivePet(c: Ctx) {
    const { inventoryId } = (await jsonBody(c)) as Partial<GeoSetActivePetRequest>;
    if (inventoryId !== null && typeof inventoryId !== "string") throw AppError.badRequest("inventoryId must be a string or null");

    return changeMe(c, (db, playerId) => {
        if (inventoryId) findPet(db, playerId, inventoryId);
        playerRepository.setActivePet(db, playerId, inventoryId);
        // The active loadout keeps its pet in step.
        syncActiveLoadout(db, playerId);
    });
}

/**
 * `PUT /geo/me/pets/:inventoryId/item`: the pet holds one of a stack of pet
 * items, used up. Whatever it held before comes back to the inventory.
 */
export async function givePetItem(c: Ctx) {
    const petId = c.req.param("inventoryId") ?? "";
    const { inventoryId: heldRowId } = (await jsonBody(c)) as Partial<GeoPetItemRequest>;
    if (typeof heldRowId !== "string" || !heldRowId) throw AppError.badRequest("Missing inventoryId");

    return changeMe(c, (db, playerId) => {
        const pet = findPet(db, playerId, petId);
        const heldRow = playerRepository.findInventoryRow(db, playerId, heldRowId);
        const held = heldRow ? CONTENT.items[heldRow.item_id] : undefined;
        if (!heldRow || held?.kind !== "petItem") throw AppError.badRequest("Pets can only hold pet items");

        playerRepository.takeFromInventory(db, playerId, heldRowId, 1);
        const previous = pet.pet?.heldItem;
        if (previous && CONTENT.items[previous]) playerRepository.grantItems(db, playerId, [{ itemId: previous, quantity: 1 }]);
        playerRepository.setPetHeldItem(db, playerId, petId, held.id);
    });
}

/** `DELETE /geo/me/pets/:inventoryId/item`: the held item comes back, for coins by its rarity. */
export function takePetItem(c: Ctx) {
    const petId = c.req.param("inventoryId") ?? "";
    return changeMe(c, (db, playerId) => {
        const pet = findPet(db, playerId, petId);
        const heldId = pet.pet?.heldItem;
        if (!heldId) throw AppError.badRequest("That pet isn't holding anything");
        const held = CONTENT.items[heldId];
        // A held item since removed from the content is just cleared, free.
        if (held) {
            const cost = GAME_CONFIG.pets.heldItemRemovalCost[held.rarity];
            playerRepository.spendCoins(db, playerId, cost, "pet-item-removal", `pet:${petId}:${heldId}`);
            playerRepository.grantItems(db, playerId, [{ itemId: heldId, quantity: 1 }]);
        }
        playerRepository.setPetHeldItem(db, playerId, petId, null);
    });
}
