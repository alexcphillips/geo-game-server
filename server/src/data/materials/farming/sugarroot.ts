import type { Material } from "#geo/models";

export default {
    id: "sugarroot",
    name: "Sugarroot",
    rarity: "rare",
    icon: "beet",
    description: "Mites have been at it, and left it sweeter than they found it.",
    stats: [{ label: "From", value: "A mutation" }],
    sellValue: 80,
    skill: "farming",
} satisfies Material;
