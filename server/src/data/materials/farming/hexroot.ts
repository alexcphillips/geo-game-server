import type { Material } from "#geo/models";

export default {
    id: "hexroot",
    name: "Hexroot",
    rarity: "epic",
    icon: "plant-roots",
    description: "It grew the wrong way, on purpose.",
    stats: [{ label: "From", value: "A mutation" }],
    sellValue: 120,
    skill: "farming",
} satisfies Material;
