import type { Material } from "#geo/models";

export default {
    id: "corn-seeds",
    name: "Corn Seeds",
    rarity: "common",
    icon: "seedling",
    description: "Dry yellow kernels that remember being a whole cob.",
    stats: [{ label: "Grows into", value: "Corn" }],
    sellValue: 2,
    skill: "farming",
} satisfies Material;
