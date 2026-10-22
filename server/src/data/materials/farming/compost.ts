import type { Material } from "#geo/models";

export default {
    id: "compost",
    name: "Compost",
    rarity: "common",
    icon: "fertilizer-bag",
    description: "Last season's leftovers, ready to make room for this one's.",
    stats: [
        { label: "From", value: "A Compost Bin, from your harvests and clears" },
        { label: "Used for", value: "Buying farm tiles, and building" },
    ],
    sellValue: 4,
    skill: "farming",
} satisfies Material;
