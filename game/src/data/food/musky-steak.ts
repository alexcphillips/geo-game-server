import type { Food } from "#geo/models";

export default {
    id: "musky-steak",
    name: "Musky Steak",
    rarity: "epic",
    icon: "hot-meal",
    description: "A slab of hard-won fish. Eat it and feel stronger.",
    effectText: ["Spiced: Attack +20% for your next 3 turns"],
    heal: 100,
    tags: ["fish"],
    actions: [{ type: "applyStatus", to: "self", status: "spiced" }],
} satisfies Food;
