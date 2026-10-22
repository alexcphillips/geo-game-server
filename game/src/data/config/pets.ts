import type { PetsConfig } from "#geo/models";

// PLACEHOLDER numbers throughout: the shape is Hypixel SkyBlock's, the values are guesses.
export default {
    maxLevel: 100,
    // To level 100: ~19,800 XP common, ~89,100 legendary (Combat 50 is 122,500).
    xpCurve: { base: 4, rarityMultiplier: { common: 1, uncommon: 1.5, rare: 2.25, epic: 3.25, legendary: 4.5 } },
    otherSkillShare: 1 / 3,
    skillMultiplier: { fishing: 1.5, mining: 1.5 },
    // Kat, raising a pet from each rarity to the next.
    upgrades: {
        common: { coins: 1_000, hours: 1 },
        uncommon: { coins: 5_000, hours: 6 },
        rare: { coins: 25_000, hours: 24 },
        epic: { coins: 100_000, hours: 72 },
    },
    upgradeDiscountPerLevel: 0.003,
    heldItemRemovalCost: { common: 100, uncommon: 500, rare: 2_500, epic: 10_000, legendary: 50_000 },
} satisfies PetsConfig;
