import type { Food } from "#geo/models";

export default {
    id: "whiskers-feast",
    name: "Whiskers Feast",
    rarity: "legendary",
    icon: "hot-meal",
    description: "A legend, served whole. One plate feeds a fight.",
    stats: [{ label: "Then", value: "8 a turn for 3 turns" }],
    effectText: ["Well Fed: heals 8 at the start of each of your next 3 turns", "Spiced: Attack +20% for your next 3 turns"],
    heal: 150,
    tags: ["fish"],
    actions: [
        { type: "applyStatus", to: "self", status: "well-fed" },
        { type: "applyStatus", to: "self", status: "spiced" },
    ],
} satisfies Food;
