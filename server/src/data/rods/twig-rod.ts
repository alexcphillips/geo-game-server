import type { Rod } from "#geo/models";

// The starter rod: small fry only, and nothing worth grading.
export default {
    id: "twig-rod",
    name: "Twig Rod",
    rarity: "common",
    icon: "fishing-pole",
    description: "A bent stick and some string. Anything bigger than your hand would snap it.",
    rod: { power: 3, line: 10, maxRarity: "common", maxTier: null },
    sellValue: 1,
} satisfies Rod;
