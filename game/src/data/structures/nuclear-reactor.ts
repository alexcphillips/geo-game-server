import type { Structure } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "nuclear-reactor",
    name: "Nuclear Reactor",
    icon: "nuclear-plant",
    description: "Enormous output. Enormous mess.",
    stats: [{ label: "Reactor", value: "Crops within 2 tiles grow an extra stage a cycle. 35% a cycle, nuclear waste lands within 2 tiles" }],
    cost: [{ itemId: "golden-scarab", quantity: 2 }, { itemId: "stardust", quantity: 3 }, { itemId: "beetle-shell", quantity: 10 }],
    effect: { kind: "reactor", radius: 2, growth: 1, wasteChance: 0.35 },
} satisfies Structure;
