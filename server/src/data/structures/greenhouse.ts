import type { Structure } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "greenhouse",
    name: "Greenhouse",
    icon: "greenhouse",
    description: "Glass on every side. Safe, steady, and a little dull.",
    stats: [{ label: "Shelters", value: "Crops grow under its roof: no weather, no pests arrive, no mutations sprout" }],
    size: { width: 3, height: 3 },
    cost: [{ itemId: "wheat", quantity: 20 }, { itemId: "beetle-shell", quantity: 8 }, { itemId: "pumpkin", quantity: 4 }],
    effect: { kind: "greenhouse" },
} satisfies Structure;
