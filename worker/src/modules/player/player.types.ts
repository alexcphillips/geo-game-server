import type { GeoRole } from "@geo/shared";
import type { PetCopy } from "../../../../game/src/pets/pets";

/** Rows as SQLite returns them: snake_case, times in ms, JSON as text. */

export type PlayerRow = {
    id: string;
    display_name: string;
    coins: number;
    bank_coins: number;
    role: GeoRole;
    created_at: number;
};

export type PlayerStateRow = {
    talisman_bag_pages: number;
    lunchbox_slots: number;
    bait_slots: number;
    health: number | null;
    camp_latitude: number | null;
    camp_longitude: number | null;
    camp_set_at: number | null;
};

/** An inventory row as stored; `pet` is JSON. */
export type InventoryRecord = {
    id: string;
    item_id: string;
    quantity: number;
    charges_left: number | null;
    reforge: string | null;
    pet: string | null;
    obtained_at: number;
};

/** An inventory row with its pet copy parsed. */
export type InventoryRow = Omit<InventoryRecord, "pet"> & { pet: PetCopy | null };

export type EquipmentRow = { slot: string; inventory_id: string };

export type TalismanBagRow = { item_id: string; inventory_id: string };

/** `inventory_ids` is a JSON array. */
export type HandRow = { skill: string; inventory_ids: string };

export type SavedHandRow = { id: string; skill: string; name: string; inventory_ids: string; created_at: number };

export type SlotRow = { slot: number; item_id: string; quantity: number };

export type SkillXpRow = { skill: string; xp: number };

export type PetUpgradeRecord = {
    inventory_id: string;
    item_id: string;
    to_item_id: string;
    pet: string;
    obtained_at: number;
    ready_at: number;
};

export type UsesRow = { equipped: number; bagged: number; in_hand: number; active_pet: number };
