import type { GeoHandCard } from "./run.contract";
import type { GeoFishingTier } from "./place.contract";
import type { GeoRarity } from "./content.contract";

/**
 * Fishing Runs: a session at a fishing spot. Each cast spends one bait, the
 * bobber plunges under, and a strike hooks a fish to fight one card per
 * turn. A landed fish goes straight into the inventory. The server runs every
 * step; the app shows what it says.
 */

/** Quality tiers, lowest first. A catch below Bronze has none. */
export const GEO_QUALITY_TIERS = ["bronze", "silver", "gold", "ruby"] as const;
export type GeoQualityTier = (typeof GEO_QUALITY_TIERS)[number];

export type GeoFishIntent = "run" | "thrash" | "dive" | "rest" | "jump";

/**
 * ready: nothing in the water. waiting: the bobber is under, strike it.
 * creature: a sea creature is on the line. fight: one card per turn. over:
 * the cast ended (see outcome).
 */
export type GeoFishingPhase = "ready" | "waiting" | "creature" | "fight" | "over";

export type GeoFishingStatuses = {
    /** Turns left in which it can't throw the hook or escape. */
    hooked: number;
    /** Your next progress card counts double. */
    tired: number;
    /** Stacks from Give Slack, spent by Reel. */
    momentum: number;
    /** Turns left in which zone turns give an extra Finesse. */
    focus: number;
    /** Turns left in which the fish's next moves show. */
    reading: number;
};

/** A fight as the player sees it: the fish's name stays hidden until it lands. */
export type GeoFishingFightView = {
    distance: number;
    maxDistance: number;
    tension: number;
    cap: number;
    zoneLow: number;
    zoneHigh: number;
    stamina: number;
    maxStamina: number;
    finesse: number;
    turn: number;
    par: number;
    /**
     * The fish's next moves; the first is the one it makes this turn. Only the
     * first is sent unless the player is reading the water.
     */
    intents: GeoFishIntent[];
    statuses: GeoFishingStatuses;
    exhausted: boolean;
    frenzy: boolean;
    /** Traits a player can see on the fish, e.g. "slippery". */
    traits: string[];
};

/** Enough to draw the dark shape on the line without saying what it is. */
export type GeoFishSilhouette = {
    /** Which fish's art to draw, as a silhouette. */
    fishId: string;
};

export type GeoFishingOutcome =
    | {
          kind: "landed";
          fishId: string;
          name: string;
          rarity: GeoRarity;
          tier: GeoQualityTier | null;
          /** The inventory item it went in as. */
          itemId: string;
          /** e.g. "Reeled in", "Gaffed". */
          how: string;
          turns: number;
          xp: number;
      }
    | { kind: "lost"; reason: string; turns: number }
    /**
     * A sea creature: the fishing Run is over and its combat Run has started.
     * Open the combat screen to fight it.
     */
    | { kind: "creature"; enemyId: string; name: string };

export type GeoFishingRunView = {
    id: string;
    /** The water: which rarities can bite. */
    tier: GeoFishingTier;
    phase: GeoFishingPhase;
    /** While hooked or fighting. */
    fish: GeoFishSilhouette | null;
    fight: GeoFishingFightView | null;
    outcome: GeoFishingOutcome | null;
    /** One line on what just happened. */
    message: string;
    /** What the last turn did, in order. */
    lastTurn: string[];
    /** The fishing hand, with charges as they stand. */
    hand: GeoHandCard[];
    /** The bait the current cast used, if any. */
    baitItemId: string | null;
    /** Fishing Power: rod power plus the fishing level. */
    power: number;
    /** The equipped rod: the rarest fish it can hook, and the best quality it can land (null: none). */
    rod: { name: string; maxRarity: GeoRarity; maxTier: GeoQualityTier | null };
};

/** `POST /geo/fishing`: open (or resume) a fishing Run at water of this tier. */
export type GeoStartFishingRequest = {
    tier: GeoFishingTier;
};

/** `POST /geo/fishing/:runId/actions`: one step of the cast. */
export type GeoFishingAction =
    | { type: "cast" }
    | { type: "strike" }
    | { type: "cutLine" }
    | { type: "fightCreature" }
    | { type: "play"; inventoryId: string };

export const GEO_FISHING_ACTION_TYPES = [
    "cast",
    "strike",
    "cutLine",
    "fightCreature",
    "play",
] as const satisfies readonly GeoFishingAction["type"][];
