import type { Material } from "#geo/models";

export default {
    id: "worm-castings",
    name: "Worm Castings",
    rarity: "common",
    icon: "worms",
    description: "Rich, dark, and very good for soil, one day.",
    stats: [{ label: "From", value: "Pests" }],
    sellValue: 3,
    skill: "farming",
} satisfies Material;
