import type { Material } from "#geo/models";

export default {
    id: "bloodmelon",
    name: "Bloodmelon",
    rarity: "epic",
    icon: "hypersonic-melon",
    description: "Red to the rind, and warm to the touch.",
    stats: [{ label: "From", value: "A mutation" }],
    sellValue: 200,
    skill: "farming",
} satisfies Material;
