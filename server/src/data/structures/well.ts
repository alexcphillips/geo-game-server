import type { Structure } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "well",
    name: "Well",
    icon: "well",
    description: "Cold water a bucket's drop away, whatever the sun is doing.",
    stats: [{ label: "Drought", value: "Tiles within 2 never go dry, even in a heatwave" }],
    cost: [{ itemId: "potato", quantity: 10 }, { itemId: "worm-castings", quantity: 3 }, { itemId: "beetle-shell", quantity: 4 }],
    effect: { kind: "well", radius: 2 },
} satisfies Structure;
