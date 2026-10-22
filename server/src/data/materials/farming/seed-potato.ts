import type { Material } from "#geo/models";

export default {
    id: "seed-potato",
    name: "Seed Potato",
    rarity: "common",
    icon: "potato",
    description: "A potato kept back to grow more potatoes.",
    stats: [{ label: "Grows into", value: "Potato" }],
    sellValue: 1,
    skill: "farming",
} satisfies Material;
