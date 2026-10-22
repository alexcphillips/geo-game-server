import type { Material } from "#geo/models";

export default {
    id: "wheat",
    name: "Wheat",
    rarity: "common",
    icon: "wheat",
    description: "A sheaf of golden wheat. Mills into flour.",
    sellValue: 1,
    skill: "farming",
} satisfies Material;
