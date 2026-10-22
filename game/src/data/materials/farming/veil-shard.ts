import type { Material } from "#geo/models";

export default {
    id: "veil-shard",
    name: "Veil Shard",
    rarity: "epic",
    icon: "crystal-shine",
    description: "A sliver of whatever is on the other side of the Portal.",
    stats: [{ label: "From", value: "Portal pests" }],
    sellValue: 120,
    skill: "farming",
} satisfies Material;
