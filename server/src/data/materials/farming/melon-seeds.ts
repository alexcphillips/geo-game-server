import type { Material } from "#geo/models";

export default {
    id: "melon-seeds",
    name: "Melon Seeds",
    rarity: "uncommon",
    icon: "seedling",
    description: "Black seeds from a summer fruit.",
    stats: [{ label: "Grows into", value: "Melon" }],
    sellValue: 2,
    skill: "farming",
} satisfies Material;
