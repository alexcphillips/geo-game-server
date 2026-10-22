import type { Card } from "#geo/models";

export default {
    id: "barrier",
    name: "Barrier",
    rarity: "common",
    icon: "magic-shield",
    description: "A shell of gold light that holds until it breaks. Casting again starts it fresh.",
    stats: [{ label: "Barrier", value: "10" }],
    skill: "combat",
    maxCharges: 25,
    targets: "self",
    actions: [{ type: "barrier", to: "self", amount: 10 }],
} satisfies Card;
