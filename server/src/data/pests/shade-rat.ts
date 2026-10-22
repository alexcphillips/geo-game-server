import type { Pest } from "#geo/models";

// PLACEHOLDER numbers. Elite: only from a Portal. Takes 3 hits.
export default {
    id: "shade-rat",
    name: "Shade Rat",
    icon: "mouse",
    description: "Its shadow arrives first.",
    likes: [],
    behaviour: { kind: "eat", reach: 1 },
    weight: 0,
    hp: 3,
    drops: [
        { itemId: "veil-shard", chance: 1, quantity: { min: 1, max: 2 } },
        { itemId: "golden-scarab", chance: 0.25, quantity: { min: 1, max: 1 } },
    ],
    xp: 45,
} satisfies Pest;
