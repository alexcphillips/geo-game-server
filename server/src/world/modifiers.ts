import { CONTENT, FIRST_MAYOR_ID, GAME_CONFIG, reforgeModifiers } from "../content";
import type { MayorDef } from "../content/content.types";
import { CORE_STATS, type StatModifier } from "../engine/engine.types";
import { applyModifiers } from "../engine/stats";
import { activePetModifiers, type PetCopy } from "../pets/pets";

/**
 * The modifier maths behind global effects, with no database: each server
 * loads the gear, bag, pet and mayor its own way (`global-effects.ts` from
 * Postgres, the Worker from SQLite) and hands them here.
 */

/** What a player has on that changes their stats: worn copies, bagged talismans, the active pet's row. */
export type ModifierSources = {
    worn: { itemId: string; reforge: string | null }[];
    talismans: string[];
    pet: { item_id: string; pet: PetCopy | null } | undefined;
};

/** The mayor a winner id names; none, or one since removed from content, is the first mayor. */
export function mayorOf(winnerId: string | null | undefined): MayorDef {
    return CONTENT.mayors[winnerId ?? FIRST_MAYOR_ID] ?? (CONTENT.mayors[FIRST_MAYOR_ID] as MayorDef);
}

/** Every global modifier for this mayor: their perks. Events and the like would join here. */
export function mayorModifiers(mayor: MayorDef): StatModifier[] {
    return mayor.perks.flatMap((perk) => perk.modifiers);
}

/** Modifiers from a player's own gear, the talismans in their bag (one copy each), and their active pet. */
export function ownModifiersFrom({ worn, talismans, pet }: ModifierSources): StatModifier[] {
    const itemIds = [...worn.map((copy) => copy.itemId), ...new Set(talismans)];
    return [
        ...itemIds.flatMap((itemId) => {
            const item = CONTENT.items[itemId];
            return item && (item.kind === "equipment" || item.kind === "talisman") ? (item.modifiers ?? []) : [];
        }),
        ...worn.flatMap((copy) => reforgeModifiers(CONTENT, copy.itemId, copy.reforge)),
        ...activePetModifiers(pet),
    ];
}

/** Max health under these modifiers, as a fight would start the player. */
export function maxHealthFrom(modifiers: StatModifier[]): number {
    const base = GAME_CONFIG.player.baseStats[CORE_STATS.maxHealth] ?? 0;
    return Math.round(applyModifiers(base, modifiers, CORE_STATS.maxHealth));
}
