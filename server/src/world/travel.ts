import { distanceMetres, type GeoPoint } from "@geo/shared";

/**
 * Walking earns spawns. The couch gets the slow trickle in SPAWN_RULES; every
 * `metresPerSpawn` walked banks one more, placed at once, skipping the gap.
 *
 * Only the last anchor point is kept, overwritten as the player moves. A leg
 * counts when it's past GPS drift, no faster than a jog, and not so long
 * apart that it's really "opened the app somewhere else".
 *
 * All numbers here are PLACEHOLDERS to tune.
 */
export const TRAVEL_RULES = {
    /** Moves shorter than this from the anchor are GPS drift, not walking. */
    anchorMetres: 25,
    /** Faster than a jog (a bike, a car, a GPS jump); the leg doesn't count. */
    maxSpeedKmh: 12,
    /** A leg over this long isn't a walk we saw; it doesn't count. */
    maxLegSeconds: 300,
    /** Walk this far for one spawn. */
    metresPerSpawn: 75,
    /** At most this many spawns banked, so a long walk can't be hoarded. */
    maxBankedSpawns: 3,
} as const;

export type Travel = GeoPoint & {
    /** When the player was at the anchor, in ms. */
    at: number;
    bankedMetres: number;
};

const MAX_BANKED_METRES = TRAVEL_RULES.metresPerSpawn * TRAVEL_RULES.maxBankedSpawns;
const MAX_LEG_MS = TRAVEL_RULES.maxLegSeconds * 1000;

/** The player's travel after being seen at `here`. */
export function advanceTravel(previous: Travel | null, here: GeoPoint, now: number): Travel {
    const fresh = { latitude: here.latitude, longitude: here.longitude, at: now };
    if (!previous) return { ...fresh, bankedMetres: 0 };

    const metres = distanceMetres(previous, here);
    const elapsedMs = now - previous.at;
    if (metres < TRAVEL_RULES.anchorMetres) {
        // Standing still: keep the anchor, but don't let it go stale, or the
        // first real leg after a sit would be thrown out as too long.
        return elapsedMs > MAX_LEG_MS ? { ...fresh, bankedMetres: previous.bankedMetres } : previous;
    }

    const kmh = elapsedMs > 0 ? metres / 1000 / (elapsedMs / 3_600_000) : Infinity;
    const counts = elapsedMs <= MAX_LEG_MS && kmh <= TRAVEL_RULES.maxSpeedKmh;
    const bankedMetres = Math.min(MAX_BANKED_METRES, previous.bankedMetres + (counts ? metres : 0));
    return { ...fresh, bankedMetres };
}

/** Spends banked distance on up to `wanted` spawns: how many, and what's left. */
export function spendTravel(travel: Travel, wanted: number): { spawns: number; travel: Travel } {
    const earned = Math.floor(travel.bankedMetres / TRAVEL_RULES.metresPerSpawn);
    const spawns = Math.max(0, Math.min(earned, wanted));
    return { spawns, travel: { ...travel, bankedMetres: travel.bankedMetres - spawns * TRAVEL_RULES.metresPerSpawn } };
}
