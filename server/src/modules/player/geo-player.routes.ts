import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as petsController from "./geo-pets.controller";
import * as playerController from "./geo-player.controller";

/** The signed-in player's own state: inventory, equipment, talisman bag, hands, lunchbox, bait, XP, health, camp and pets. */
export const geoPlayerRouter: Router = Router();

geoPlayerRouter.get(GEO_API_PATHS.me.root, geoAuth, asyncHandler(playerController.getMe));
geoPlayerRouter.put(GEO_API_PATHS.me.equipmentSlot, geoAuth, asyncHandler(playerController.setEquipment));
geoPlayerRouter.put(GEO_API_PATHS.me.talismanBagEntry, geoAuth, asyncHandler(playerController.addToTalismanBag));
geoPlayerRouter.delete(GEO_API_PATHS.me.talismanBagEntry, geoAuth, asyncHandler(playerController.removeFromTalismanBag));
geoPlayerRouter.put(GEO_API_PATHS.me.hand, geoAuth, asyncHandler(playerController.setHand));
geoPlayerRouter.post(GEO_API_PATHS.me.savedHands, geoAuth, asyncHandler(playerController.saveHand));
geoPlayerRouter.post(GEO_API_PATHS.me.loadSavedHand, geoAuth, asyncHandler(playerController.loadSavedHand));
geoPlayerRouter.delete(GEO_API_PATHS.me.savedHand, geoAuth, asyncHandler(playerController.deleteSavedHand));
geoPlayerRouter.put(GEO_API_PATHS.me.lunchboxSlot, geoAuth, asyncHandler(playerController.packLunchbox));
geoPlayerRouter.delete(GEO_API_PATHS.me.lunchboxSlot, geoAuth, asyncHandler(playerController.unpackLunchbox));
geoPlayerRouter.post(GEO_API_PATHS.me.eatLunchbox, geoAuth, asyncHandler(playerController.eatLunchbox));
geoPlayerRouter.put(GEO_API_PATHS.me.baitSlot, geoAuth, asyncHandler(playerController.packBait));
geoPlayerRouter.delete(GEO_API_PATHS.me.baitSlot, geoAuth, asyncHandler(playerController.unpackBait));
geoPlayerRouter.put(GEO_API_PATHS.me.camp, geoAuth, asyncHandler(playerController.setCamp));
geoPlayerRouter.delete(GEO_API_PATHS.me.camp, geoAuth, asyncHandler(playerController.clearCamp));
geoPlayerRouter.post(GEO_API_PATHS.me.bankDeposit, geoAuth, asyncHandler(playerController.bankDeposit));
geoPlayerRouter.post(GEO_API_PATHS.me.bankWithdraw, geoAuth, asyncHandler(playerController.bankWithdraw));
geoPlayerRouter.put(GEO_API_PATHS.me.activePet, geoAuth, asyncHandler(petsController.setActivePet));
geoPlayerRouter.put(GEO_API_PATHS.me.petItem, geoAuth, asyncHandler(petsController.givePetItem));
geoPlayerRouter.delete(GEO_API_PATHS.me.petItem, geoAuth, asyncHandler(petsController.takePetItem));
