import type { Pest } from "#geo/models";

// PLACEHOLDER numbers. Elite: only from a Portal. Takes 2 hits.
export default {
    id: "rift-locust",
    name: "Rift Locust",
    icon: "long-antennae-bug",
    description: "Too many legs, and they don't all bend the right way.",
    likes: [],
    behaviour: { kind: "eat", reach: 2 },
    weight: 0,
    hp: 2,
    drops: [
        { itemId: "veil-shard", chance: 1, quantity: { min: 1, max: 1 } },
        { itemId: "golden-scarab", chance: 0.2, quantity: { min: 1, max: 1 } },
    ],
    xp: 30,
} satisfies Pest;
