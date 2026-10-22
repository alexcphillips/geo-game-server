import type { Material } from "#geo/models";

export default {
    id: "golden-scarab",
    name: "Golden Scarab",
    rarity: "rare",
    icon: "scarab-beetle",
    description: "A beetle that shines like a coin. Pests carry them, rarely.",
    stats: [{ label: "From", value: "Pests" }],
    sellValue: 60,
    skill: "farming",
} satisfies Material;
