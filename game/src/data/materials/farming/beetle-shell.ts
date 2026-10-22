import type { Material } from "#geo/models";

export default {
    id: "beetle-shell",
    name: "Beetle Shell",
    rarity: "common",
    icon: "beetle-shell",
    description: "A hopper beetle's hard wing case.",
    stats: [{ label: "From", value: "Pests" }],
    sellValue: 4,
    skill: "farming",
} satisfies Material;
