import type { Material } from "#geo/models";

export default {
    id: "carrot-seeds",
    name: "Carrot Seeds",
    rarity: "common",
    icon: "seedling",
    description: "Tiny seeds for a root that grows down, not up.",
    stats: [{ label: "Grows into", value: "Carrot" }],
    sellValue: 1,
    skill: "farming",
} satisfies Material;
