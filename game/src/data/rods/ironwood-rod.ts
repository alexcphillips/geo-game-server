import type { Rod } from "#geo/models";

export default {
    id: "ironwood-rod",
    name: "Ironwood Rod",
    rarity: "epic",
    icon: "fishing-pole",
    description: "Heavy as a crowbar and twice as stubborn. Built for open water.",
    rod: { power: 15, line: 16, maxRarity: "epic", maxTier: "gold" },
    sellValue: 2000,
} satisfies Rod;
