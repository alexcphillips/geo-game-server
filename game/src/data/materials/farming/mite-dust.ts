import type { Material } from "#geo/models";

export default {
    id: "mite-dust",
    name: "Mite Dust",
    rarity: "common",
    icon: "powder",
    description: "A pinch of what a mite colony becomes.",
    stats: [{ label: "From", value: "Pests" }],
    sellValue: 2,
    skill: "farming",
} satisfies Material;
