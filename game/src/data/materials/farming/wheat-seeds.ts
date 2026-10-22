import type { Material } from "#geo/models";

export default {
    id: "wheat-seeds",
    name: "Wheat Seeds",
    rarity: "common",
    icon: "seedling",
    description: "Plant in spring, or whenever the plot is free.",
    stats: [{ label: "Grows into", value: "Wheat" }],
    sellValue: 1,
    skill: "farming",
} satisfies Material;
