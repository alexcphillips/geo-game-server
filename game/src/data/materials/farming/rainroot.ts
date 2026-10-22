import type { Material } from "#geo/models";

export default {
    id: "rainroot",
    name: "Rainroot",
    rarity: "rare",
    icon: "plant-roots",
    description: "A root that grew sideways looking for more rain.",
    stats: [{ label: "From", value: "A mutation" }],
    sellValue: 70,
    skill: "farming",
} satisfies Material;
