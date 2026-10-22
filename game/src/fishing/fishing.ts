import { GAME_CONFIG } from "../content";
import type { StatModifier } from "../engine/engine.types";
import { applyModifiers } from "../engine/stats";

/**
 * Fishing odds, ready for the fishing Run when it's built: base chances, and
 * every modifier the player has — the mayor's perks (Marlon's Eel Affinity (+0.10 eel chance),
 * Bait Lover, Fishing Master), gear and talismans — applied the same way
 * combat stats are. PLACEHOLDER base numbers, in `data/config/fishing.ts`.
 *
 *     const odds = fishingOdds(await playerModifiers(playerId));
 *     if (rng.chance(odds.eelChance)) …
 */
export const FISHING_BASE = GAME_CONFIG.fishing.baseOdds;

export type FishingOdds = Record<keyof typeof FISHING_BASE, number>;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function fishingOdds(modifiers: readonly StatModifier[]): FishingOdds {
    return {
        eelChance: clamp01(applyModifiers(FISHING_BASE.eelChance, modifiers, "eelChance")),
        baitSaveChance: clamp01(applyModifiers(FISHING_BASE.baitSaveChance, modifiers, "baitSaveChance")),
        seaCreatureChance: clamp01(applyModifiers(FISHING_BASE.seaCreatureChance, modifiers, "seaCreatureChance")),
    };
}
