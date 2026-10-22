import type { Material } from "#geo/models";

export default {
    id: "grinning-gourd",
    name: "Grinning Gourd",
    rarity: "rare",
    icon: "pumpkin-lantern",
    description: "Something nibbled a face into it while it grew. It's still smiling.",
    stats: [{ label: "From", value: "A mutation" }],
    sellValue: 90,
    skill: "farming",
} satisfies Material;
