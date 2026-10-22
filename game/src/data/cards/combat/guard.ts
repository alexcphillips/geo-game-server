import type { Card } from "#geo/models";

export default {
    id: "guard",
    name: "Guard",
    rarity: "uncommon",
    icon: "checked-shield",
    description: "Raise your shield and take the hit.",
    stats: [
        { label: "Guard", value: "10" },
    ],
    requiresOffHand: ["shield"],
    skill: "combat",
    maxCharges: 40,
    targets: "self",
    actions: [{ type: "guard", to: "self", amount: 10 }],
} satisfies Card;
