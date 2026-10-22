import type { Card } from "#geo/models";

export default {
    id: "fish.steady",
    name: "Steady",
    rarity: "common",
    icon: "hand",
    description: "Slow and even.",
    stats: [
        { label: "Role", value: "Progress" },
        { label: "Does", value: "−1 Distance. +1 Finesse if Tension ends in the zone." },
    ],
    skill: "fishing",
    maxCharges: 40,
    finesse: "raises",
    targets: "self",
} satisfies Card;
