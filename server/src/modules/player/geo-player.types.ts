import type { GeoRole } from "@geo/shared";
import type { PetCopy } from "../../pets/pets";

/** Rows as pg returns them, snake_case. */

export type PlayerRow = {
    id: string;
    display_name: string;
    coins: string; // BIGINT arrives as a string
    bank_coins: string;
    role: GeoRole;
    created_at: Date;
};

export type InventoryRow = {
    id: string;
    player_id: string;
    item_id: string;
    quantity: number;
    charges_left: number | null;
    /** Weapons and armor: its reforge id (`data/reforges/`), if reforged. */
    reforge: string | null;
    /** Pets: the copy's XP and held item; null for anything else. */
    pet: PetCopy | null;
    obtained_at: Date;
};

export type EquipmentRow = {
    slot: string;
    inventory_id: string;
};

export type TalismanBagRow = {
    item_id: string;
    inventory_id: string;
};

export type HandRow = {
    skill: string;
    inventory_ids: string[];
};

export type SavedHandRow = {
    id: string;
    skill: string;
    name: string;
    inventory_ids: string[];
    created_at: Date;
};

export type LunchboxRow = {
    slot: number;
    item_id: string;
    quantity: number;
};

/** A geo.bait row: the same shape as a lunchbox one. */
export type BaitRow = LunchboxRow;

export type SkillXpRow = {
    skill: string;
    xp: string; // BIGINT
};

export type HealthAndCampRow = {
    health: number | null;
    camp_latitude: number | null;
    camp_longitude: number | null;
    camp_set_at: Date | null;
};

/** A pet left with Kat (geo.pet_upgrades). */
export type PetUpgradeRow = {
    inventory_id: string;
    item_id: string;
    to_item_id: string;
    pet: PetCopy;
    obtained_at: Date;
    ready_at: Date;
};
