import type { SpawnsConfig } from "#geo/models";

export default {
    reachMetres: 60,
    // 10 m short of reach, so GPS drift doesn't put a fresh spawn out of reach.
    maxSpawnMetres: 50,
    minSpawnMetres: 10,
    outOfReachSeconds: 45,
    respawnAfterWinSeconds: 60,
    // ~2.7 at once on average (was ~2.1 with [40, 30, 17, 9, 4]).
    countWeights: [22, 27, 23, 16, 12],
    windowMinutes: 15,
    spawnGapSeconds: 140,
    lifetimeMinutes: { min: 4, max: 8 },
    // PLACEHOLDER. Front-loaded: tier 2 comes quickly (~25 kills), later
    // tiers take longer as levels do.
    tierUnlockLevels: [1, 5, 12, 22, 35],
    // One tier below is 40% as common as your own, two below 15%, any lower 5%.
    lowerTierWeights: [0.4, 0.15, 0.05],
    // PLACEHOLDER. Half as strong as the anywhere pool: a quest's target
    // (the Trial's river crab) turns up every few spawns, even far from water.
    questTargetWeight: 0.5,
    // NOTE: enemies array is the "everywhere" pool.
    enemies: [
        { enemyId: "spider", weight: 10 },
        { enemyId: "green-slime", weight: 10 },
    ],
    // PLACEHOLDER pulls. Each new spawn picks where it's from by weight:
    // `enemies` above has 1; a place nearby has its `weight` when you're on
    // it, fading to nothing at `influenceMetres`. Who lives where is on each
    // enemy, as `habitats`.
    habitats: {
        // Kept within maxSpawnMetres, so water creatures always land on the shore.
        water: { influenceMetres: 50, weight: 0.7 },
        mining: { influenceMetres: 100, weight: 1.5 },
        foraging: { influenceMetres: 100, weight: 1 },
        farming: { influenceMetres: 100, weight: 1 },
        landmark: { influenceMetres: 50, weight: 0.8 },
    },
} satisfies SpawnsConfig;
