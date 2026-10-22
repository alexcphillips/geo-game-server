import type { Rod } from "#geo/models";

export default {
    id: "leviathan-rod",
    name: "Leviathan Rod",
    rarity: "legendary",
    icon: "fishing-pole",
    description: "Strung with a line no fish has ever broken. Yet.",
    rod: { power: 20, line: 18, maxRarity: "legendary", maxTier: "ruby" },
    sellValue: 10000,
} satisfies Rod;
