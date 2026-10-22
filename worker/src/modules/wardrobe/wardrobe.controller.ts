import type { Context } from "hono";
import {
    GEO_LOADOUT_ACTIVITIES,
    GEO_LOADOUT_NAME_MAX,
    type GeoLoadoutActivity,
    type GeoLoadoutAutoRequest,
    type GeoSaveLoadoutRequest,
} from "@geo/shared";
import { AppError } from "../../../../game/src/http/AppError";
import type { AppEnv } from "../../app";
import { jsonBody } from "../../http/body";
import { changeMe } from "../player/player.controller";
import * as playerRepository from "../player/player.repository";
import * as runsRepository from "../runs/runs.repository";
import * as wardrobeRepository from "./wardrobe.repository";

/** The wardrobe. Every reply is the whole player. */

type Ctx = Context<AppEnv>;

function parseSlot(c: Ctx): number {
    const slot = Number(c.req.param("slot"));
    if (!Number.isInteger(slot) || slot < 0) throw AppError.badRequest("Unknown loadout slot");
    return slot;
}

/** `PUT /geo/me/wardrobe/:slot`: saves what's worn into the slot (and makes it active), or only renames it. */
export async function saveLoadout(c: Ctx) {
    const slot = parseSlot(c);
    const { name, save } = (await jsonBody(c)) as Partial<GeoSaveLoadoutRequest>;
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed || trimmed.length > GEO_LOADOUT_NAME_MAX) throw AppError.badRequest(`A name of 1–${GEO_LOADOUT_NAME_MAX} characters`);
    if (typeof save !== "boolean") throw AppError.badRequest("save must be true or false");

    return changeMe(c, (db, playerId) => {
        wardrobeRepository.assertSlotOwned(db, playerId, slot);
        if (save) wardrobeRepository.saveWorn(db, playerId, slot, trimmed);
        else wardrobeRepository.renameLoadout(db, playerId, slot, trimmed);
    });
}

/** `DELETE /geo/me/wardrobe/:slot`: clears it. What's worn stays on. */
export function deleteLoadout(c: Ctx) {
    const slot = parseSlot(c);
    return changeMe(c, (db, playerId) => wardrobeRepository.deleteLoadout(db, playerId, slot));
}

/** `POST /geo/me/wardrobe/:slot/wear`. Not mid-Run, so gear can't change in a fight. */
export function wearLoadout(c: Ctx) {
    const slot = parseSlot(c);
    return changeMe(c, (db, playerId) => {
        runsRepository.assertNotInRun(db, playerId, "You can't change loadouts mid-Run");
        wardrobeRepository.assertSlotOwned(db, playerId, slot);
        wardrobeRepository.wearLoadout(db, playerId, slot);
    });
}

/** `PUT /geo/me/wardrobe/:slot/auto`: the loadout auto-swap wears for an activity. */
export async function setLoadoutAuto(c: Ctx) {
    const slot = parseSlot(c);
    const { autoFor } = (await jsonBody(c)) as Partial<GeoLoadoutAutoRequest>;
    if (autoFor !== null && !GEO_LOADOUT_ACTIVITIES.includes(autoFor as GeoLoadoutActivity)) {
        throw AppError.badRequest(`autoFor must be one of ${GEO_LOADOUT_ACTIVITIES.join(", ")}, or null`);
    }
    return changeMe(c, (db, playerId) => wardrobeRepository.setAutoFor(db, playerId, slot, autoFor ?? null));
}

/** `POST /geo/me/wardrobe/buy-slot`: one more loadout slot, priced by how many were bought before. */
export function buyLoadoutSlot(c: Ctx) {
    return changeMe(c, (db, playerId) => {
        const cost = wardrobeRepository.quoteSlot(db, playerId);
        playerRepository.spendCoins(db, playerId, cost, "wardrobe-slot", "wardrobe");
        wardrobeRepository.addBoughtSlot(db, playerId);
    });
}
