import type { FishingConfig } from "#geo/models";

export default {
    baseOdds: { eelChance: 0.05, baitSaveChance: 0, seaCreatureChance: 0.02 },
    rarityWeight: { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 },
    waterRarities: {
        puddle: ["common"],
        pond: ["common", "uncommon"],
        lake: ["common", "uncommon", "rare"],
        open: ["common", "uncommon", "rare", "epic", "legendary"],
    },
    rarityDifficulty: { common: 1, uncommon: 1.2, rare: 1.5, epic: 1.8, legendary: 2.2 },
    rarityPower: { common: 0, uncommon: 4, rare: 12, epic: 24, legendary: 36 },
    parTurns: { common: 3, uncommon: 4, rare: 6, epic: 8, legendary: 12 },
    sellValue: { common: 2, uncommon: 8, rare: 30, epic: 120, legendary: 480 },
    tuning: {
        zoneLow: 0.35,
        zoneHigh: 0.7,
        tierThresholds: { bronze: 2.5, silver: 4.5, gold: 7, ruby: 10 },
        maxTurns: 40,
    },
    // PLACEHOLDER: the Kraken is the only sea creature so far. Nothing lurks in a puddle.
    seaCreatures: {
        puddle: [],
        pond: [{ enemyId: "kraken", weight: 1 }],
        lake: [{ enemyId: "kraken", weight: 1 }],
        open: [{ enemyId: "kraken", weight: 1 }],
    },
} satisfies FishingConfig;
