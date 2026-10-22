import type { Material } from "#geo/models";

export default {
    id: "mouse-tail",
    name: "Mouse Tail",
    rarity: "common",
    icon: "mouse",
    description: "What the field mouse left behind.",
    stats: [{ label: "From", value: "Pests" }],
    sellValue: 3,
    skill: "farming",
} satisfies Material;
