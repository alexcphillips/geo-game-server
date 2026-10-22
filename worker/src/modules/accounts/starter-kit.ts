import type { GeoEquipmentSlot } from "@geo/shared";
import { CONTENT, GAME_CONFIG } from "../../../../server/src/content";
import type { Db } from "../../db/db";
import * as playerRepository from "../player/player.repository";
import * as wardrobeRepository from "../wardrobe/wardrobe.repository";

/**
 * What every new player starts with (`data/config/starter-kit.ts`): items,
 * saved loadouts (the first worn), a first hand for each listed skill, and
 * the lunchbox and bait packed. Inside the sign-up transaction.
 */
export function grantStarterKit(db: Db, playerId: string) {
    const kit = GAME_CONFIG["starter-kit"];
    const granted = playerRepository.findInventoryByIds(db, playerId, playerRepository.grantItems(db, playerId, kit.items));

    for (const [slot, loadout] of kit.loadouts.entries()) {
        const equipment: Partial<Record<GeoEquipmentSlot, string>> = {};
        for (const [kind, itemId] of Object.entries(loadout.equip)) {
            const entry = granted.find((row) => row.item_id === itemId);
            // A ring kind goes in the first ring slot.
            if (entry) equipment[(kind === "ring" ? "ring1" : kind) as GeoEquipmentSlot] = entry.id;
        }
        wardrobeRepository.insertLoadout(db, playerId, slot, loadout.name, equipment, null, loadout.autoFor ?? null);
    }
    if (kit.loadouts.length > 0) wardrobeRepository.wearLoadout(db, playerId, 0);

    for (const skill of kit.handSkills) {
        const hand = granted.filter((row) => {
            const item = CONTENT.items[row.item_id];
            return item?.kind === "card" && CONTENT.cards[item.cardId]?.skill === skill;
        });
        playerRepository.setHand(db, playerId, skill, hand.map((row) => row.id));
    }

    for (const [slot, { itemId, quantity }] of kit.lunchbox.entries()) playerRepository.setLunchboxSlot(db, playerId, slot, itemId, quantity);
    for (const [slot, { itemId, quantity }] of kit.bait.entries()) playerRepository.setBaitSlot(db, playerId, slot, itemId, quantity);
}
