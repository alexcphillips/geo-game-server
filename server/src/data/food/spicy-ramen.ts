import type { Food } from "#geo/models";

export default {
    id: "spicy-ramen",
    name: "Spicy Ramen",
    rarity: "uncommon",
    icon: "noodles",
    description: "Your eyes water. Your arms feel stronger.",
    effectText: ["Spiced: Attack +20% for your next 3 turns"],
    heal: 25,
    tags: ["spicy"],
    actions: [{ type: "applyStatus", to: "self", status: "spiced" }],
} satisfies Food;
