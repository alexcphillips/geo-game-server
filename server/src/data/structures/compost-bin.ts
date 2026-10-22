import type { Structure } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "compost-bin",
    name: "Compost Bin",
    icon: "barrel",
    description: "Waste in, Compost out. Slowly.",
    stats: [{ label: "Compost", value: "Every 5 harvests or clears on the farm make 1 Compost, for buying tiles and building" }],
    cost: [{ itemId: "wheat", quantity: 10 }],
    effect: { kind: "compost", capacity: 5, itemId: "compost" },
} satisfies Structure;
