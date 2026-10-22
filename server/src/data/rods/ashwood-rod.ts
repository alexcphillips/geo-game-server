import type { Rod } from "#geo/models";

export default {
    id: "ashwood-rod",
    name: "Ashwood Rod",
    rarity: "uncommon",
    icon: "fishing-pole",
    description: "Springy ash with a proper reel. Carp and pike stop laughing at you.",
    rod: { power: 7, line: 12, maxRarity: "uncommon", maxTier: "bronze" },
    sellValue: 60,
} satisfies Rod;
