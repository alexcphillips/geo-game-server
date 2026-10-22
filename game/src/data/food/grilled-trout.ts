import type { Food } from "#geo/models";

export default {
    id: "grilled-trout",
    name: "Grilled Trout",
    rarity: "common",
    icon: "fried-fish",
    description: "Charred skin, flaky middle.",
    heal: 35,
    tags: ["fish"],
} satisfies Food;
