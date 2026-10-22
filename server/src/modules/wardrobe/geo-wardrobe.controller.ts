import type { Request, Response } from "express";
import {
    GEO_LOADOUT_ACTIVITIES,
    GEO_LOADOUT_NAME_MAX,
    type GeoLoadoutActivity,
    type GeoLoadoutAutoRequest,
    type GeoSaveLoadoutRequest,
} from "@geo/shared";
import { AppError } from "../../http/AppError";
import { withTransaction } from "../../db/transaction";
import { requirePlayerId } from "../../middleware/geo-auth";
import * as playerRepository from "../player/geo-player.repository";
import * as runsRepository from "../runs/geo-runs.repository";
import * as wardrobeRepository from "./geo-wardrobe.repository";

function parseSlot(req: Request): number {
    const slot = Number(req.params.slot);
    if (!Number.isInteger(slot) || slot < 0) throw AppError.badRequest("Unknown loadout slot");
    return slot;
}

/** Every reply is the whole player, wardrobe included. */
async function replyMe(res: Response, playerId: string) {
    res.status(200).json(await playerRepository.findMe(playerId));
}

/** `PUT /geo/me/wardrobe/:slot`: saves what's worn into the slot (and makes it active), or only renames it. */
export async function saveLoadout(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const slot = parseSlot(req);
    const { name, save } = (req.body ?? {}) as Partial<GeoSaveLoadoutRequest>;
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed || trimmed.length > GEO_LOADOUT_NAME_MAX) {
        throw AppError.badRequest(`A name of 1–${GEO_LOADOUT_NAME_MAX} characters`);
    }
    if (typeof save !== "boolean") throw AppError.badRequest("save must be true or false");

    await withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        await wardrobeRepository.assertSlotOwned(tx, playerId, slot);
        if (save) await wardrobeRepository.saveWorn(tx, playerId, slot, trimmed);
        else await wardrobeRepository.renameLoadout(tx, playerId, slot, trimmed);
    });
    await replyMe(res, playerId);
}

/** `DELETE /geo/me/wardrobe/:slot`: clears it. What's worn stays on. */
export async function deleteLoadout(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const slot = parseSlot(req);
    await withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        await wardrobeRepository.deleteLoadout(tx, playerId, slot);
    });
    await replyMe(res, playerId);
}

/** `POST /geo/me/wardrobe/:slot/wear`. Not mid-Run, so gear can't change in a fight. */
export async function wearLoadout(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const slot = parseSlot(req);
    await withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        await runsRepository.assertNotInRun(tx, playerId, "You can't change loadouts mid-Run");
        await wardrobeRepository.assertSlotOwned(tx, playerId, slot);
        await wardrobeRepository.wearLoadout(tx, playerId, slot);
    });
    await replyMe(res, playerId);
}

/** `PUT /geo/me/wardrobe/:slot/auto`: the loadout auto-swap wears for an activity. */
export async function setLoadoutAuto(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const slot = parseSlot(req);
    const { autoFor } = (req.body ?? {}) as Partial<GeoLoadoutAutoRequest>;
    if (autoFor !== null && !GEO_LOADOUT_ACTIVITIES.includes(autoFor as GeoLoadoutActivity)) {
        throw AppError.badRequest(`autoFor must be one of ${GEO_LOADOUT_ACTIVITIES.join(", ")}, or null`);
    }
    await withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        await wardrobeRepository.setAutoFor(tx, playerId, slot, autoFor ?? null);
    });
    await replyMe(res, playerId);
}

/** `POST /geo/me/wardrobe/buy-slot`: one more loadout slot, priced by how many were bought before. */
export async function buyLoadoutSlot(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    await withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        const cost = await wardrobeRepository.quoteSlot(tx, playerId);
        await playerRepository.spendCoins(tx, playerId, cost, "wardrobe-slot", "wardrobe");
        await wardrobeRepository.addBoughtSlot(tx, playerId);
    });
    await replyMe(res, playerId);
}
