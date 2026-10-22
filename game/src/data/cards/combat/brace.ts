import type { Card } from "#geo/models";

export default {
    id: "brace",
    name: "Brace",
    rarity: "common",
    icon: "round-shield",
    description: "Absorb the next hits, until your next turn.",
    stats: [{ label: "Guard", value: "8" }],
    skill: "combat",
    maxCharges: 30,
    targets: "self",
    actions: [{ type: "guard", to: "self", amount: 8 }],
} satisfies Card;
