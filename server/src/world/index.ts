import { createRng, type Rng } from "../engine/rng";
import { secretSeed } from "../lib/geo-secret";
import { rollEnemyId as rollFrom, rollSpawnCount, SPAWN_RULES, windowAt } from "./spawns";

/**
 * Which enemy a new spawn is. Only SPAWN_RULES.enemies spawn on their own;
 * dev-only enemies such as the test dragon come from the admin spawn route.
 */
export function rollEnemyId(rng: Rng): string {
    return rollFrom(rng, SPAWN_RULES.enemies);
}

/**
 * How many spawns this player has this window. Seeded by the secret, so it
 * holds steady across requests in a window without being stored.
 */
export function spawnCountFor(playerId: string, now: number): number {
    return rollSpawnCount(createRng(secretSeed(`spawn-count:${playerId}:${windowAt(now)}`)));
}

export {
    enemyTierFor,
    hasArt,
    MAX_SPAWNS,
    randomPointNear,
    rollLifetimeMs,
    rollSpawn,
    rollSpawnCount,
    SPAWN_RULES,
    type NearPlace,
    type NearPlaces,
    windowAt,
} from "./spawns";

export { advanceTravel, spendTravel, TRAVEL_RULES, type Travel } from "./travel";
