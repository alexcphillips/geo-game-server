import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as petsController from "./pets.controller";
import * as playerController from "./player.controller";

/** The signed-in player's own state: inventory, equipment, talisman bag, hands, lunchbox, bait, camp, bank and pets. */
export const playerRoutes = new Hono<AppEnv>();

const me = GEO_API_PATHS.me;

playerRoutes.get(me.root, auth, playerController.getMe);
playerRoutes.put(me.equipmentSlot, auth, playerController.setEquipment);
playerRoutes.put(me.talismanBagEntry, auth, playerController.addToTalismanBag);
playerRoutes.delete(me.talismanBagEntry, auth, playerController.removeFromTalismanBag);
playerRoutes.put(me.hand, auth, playerController.setHand);
playerRoutes.post(me.savedHands, auth, playerController.saveHand);
playerRoutes.post(me.loadSavedHand, auth, playerController.loadSavedHand);
playerRoutes.delete(me.savedHand, auth, playerController.deleteSavedHand);
playerRoutes.put(me.lunchboxSlot, auth, playerController.packLunchbox);
playerRoutes.delete(me.lunchboxSlot, auth, playerController.unpackLunchbox);
playerRoutes.post(me.eatLunchbox, auth, playerController.eatLunchbox);
playerRoutes.put(me.baitSlot, auth, playerController.packBait);
playerRoutes.delete(me.baitSlot, auth, playerController.unpackBait);
playerRoutes.put(me.camp, auth, playerController.setCamp);
playerRoutes.delete(me.camp, auth, playerController.clearCamp);
playerRoutes.post(me.bankDeposit, auth, playerController.bankDeposit);
playerRoutes.post(me.bankWithdraw, auth, playerController.bankWithdraw);
playerRoutes.put(me.activePet, auth, petsController.setActivePet);
playerRoutes.put(me.petItem, auth, petsController.givePetItem);
playerRoutes.delete(me.petItem, auth, petsController.takePetItem);
