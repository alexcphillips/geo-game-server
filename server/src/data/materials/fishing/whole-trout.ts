import type { Material } from "#geo/models";

export default {
    id: "whole-trout",
    name: "Whole Trout",
    rarity: "common",
    icon: "salmon",
    description: "Fresh from the river. Cook it before it turns.",
    stats: [{ label: "Cooks into", value: "Grilled Trout" }],
    skill: "fishing",
} satisfies Material;
