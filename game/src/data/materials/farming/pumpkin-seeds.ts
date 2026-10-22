import type { Material } from "#geo/models";

export default {
    id: "pumpkin-seeds",
    name: "Pumpkin Seeds",
    rarity: "uncommon",
    icon: "seedling",
    description: "Flat, pale seeds. Give them room.",
    stats: [{ label: "Grows into", value: "Pumpkin" }],
    sellValue: 2,
    skill: "farming",
} satisfies Material;
