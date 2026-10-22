import type { Rod } from "#geo/models";

export default {
    id: "greenheart-rod",
    name: "Greenheart Rod",
    rarity: "rare",
    icon: "fishing-pole",
    description: "Dense tropical wood that bends without breaking. Strong enough for lake monsters.",
    rod: { power: 11, line: 14, maxRarity: "rare", maxTier: "silver" },
    sellValue: 375,
} satisfies Rod;
