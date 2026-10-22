import type { GeoFishIntent, GeoQualityTier } from "@geo/shared";
import type { Rarity } from "./content.types";
import type { FISH_TRAITS } from "./data.schema";

/**
 * Rod fishing's types and ids. The fish themselves are `data/fish/`, the
 * cards `data/cards/fishing/`, and every tuning number
 * `data/config/fishing.ts` (exported from `content/index.ts`).
 *
 * Fishing cards are hard-coded rules (`fishing/fishing-run.ts`) keyed by
 * card id, not engine effects: the fishing engine additions (meters, intent
 * events, conditions) replace that switch later. So a fishing card's rules
 * can't be written in its file, and every fishing card file must be one of
 * FISHING_CARD_IDS (checked at boot).
 */

export type FishTrait = (typeof FISH_TRAITS)[number];

export type FishDef = {
    id: string;
    name: string;
    rarity: Rarity;
    stamina: number;
    /** Scales every move it makes. */
    strength: number;
    /** Starting Distance; it escapes at this + 5. */
    distance: number;
    /** How often it picks each move. */
    moves: Record<GeoFishIntent, number>;
    traits: FishTrait[];
    icon: string;
    description: string;
    /** Fishing XP for landing one. */
    xp: number;
};

/** A rod's fishing numbers: see `Rod` in `#geo/models`. */
export type RodStats = { power: number; line: number; maxRarity: Rarity; maxTier: GeoQualityTier | null };
/** The rod a cast uses: the equipped rod item's name and numbers. */
export type RodDef = RodStats & { name: string };

/** The fishing cards whose rules exist in `fishing/fishing-run.ts`. */
export const FISHING_CARD_IDS = [
    "fish.reel",
    "fish.horse",
    "fish.gaff",
    "fish.slack",
    "fish.steady",
    "fish.feather",
    "fish.read",
    "fish.tire",
    "fish.hook",
    "fish.twitch",
    "fish.patient",
] as const;
export type FishingCardId = (typeof FISHING_CARD_IDS)[number];

export const isFishingCardId = (id: string): id is FishingCardId => (FISHING_CARD_IDS as readonly string[]).includes(id);

/** The item a regular catch of this fish is. */
export const fishItemId = (fishId: string) => `fish.${fishId}`;
/** The Soulbound item a quality catch is, e.g. `fish.salmon.silver`. */
export const qualityFishItemId = (fishId: string, tier: GeoQualityTier) => `fish.${fishId}.${tier}`;
