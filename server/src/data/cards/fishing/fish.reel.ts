import type { Card } from "#geo/models";

export default {
    id: "fish.reel",
    name: "Reel",
    rarity: "common",
    icon: "rope-coil",
    description: "Crank and keep cranking.",
    stats: [
        { label: "Role", value: "Progress" },
        {
            label: "Does",
            value: "−2 Distance (more with Fishing Power), +2 Tension (+1 on a Rest). Spends Momentum: −2 more per stack.",
        },
    ],
    skill: "fishing",
    maxCharges: 40,
    targets: "self",
} satisfies Card;
