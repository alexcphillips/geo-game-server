import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as wardrobeController from "./wardrobe.controller";

/** The wardrobe: saved loadouts, switching between them, and buying slots. */
export const wardrobeRoutes = new Hono<AppEnv>();

const me = GEO_API_PATHS.me;

// The purchase first, so "buy-slot" is never read as a slot number.
wardrobeRoutes.post(me.buyLoadoutSlot, auth, wardrobeController.buyLoadoutSlot);
wardrobeRoutes.put(me.loadout, auth, wardrobeController.saveLoadout);
wardrobeRoutes.delete(me.loadout, auth, wardrobeController.deleteLoadout);
wardrobeRoutes.post(me.wearLoadout, auth, wardrobeController.wearLoadout);
wardrobeRoutes.put(me.loadoutAuto, auth, wardrobeController.setLoadoutAuto);
