import type { Travel } from "../../../../server/src/world/travel";

export type SpawnRow = {
    id: string;
    enemy_id: string;
    latitude: number;
    longitude: number;
    despawns_at: number;
    claimed_at: number | null;
    created_at: number;
};

/**
 * What the World remembers about one player's walking, instead of writing a
 * row every map refresh. A restart forgets it: banked metres reset, and
 * spawns walked away from start their countdown again.
 */
export type TravelMemory = {
    travel: Travel | null;
    /** When they last got a spawn; the trickle's gap runs from here. */
    lastSpawnedAt: number;
    /** Spawn id → when the player walked out of its reach. */
    outOfReachSince: Map<string, number>;
};
