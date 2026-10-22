import type { Structure } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "pest-cage",
    name: "Pest Cage",
    icon: "cage",
    description: "Keeps one pest alive and close. Some recipes like the company.",
    stats: [{ label: "Holds", value: "One caged pest: it counts as that pest nearby for mutations" }],
    cost: [{ itemId: "beetle-shell", quantity: 6 }, { itemId: "wheat", quantity: 5 }],
    effect: { kind: "cage" },
} satisfies Structure;
