import type { Pest } from "#geo/models";

// PLACEHOLDER numbers. Only from nuclear waste (config/farming.ts waste).
export default {
    id: "glow-beetle",
    name: "Glow Beetle",
    icon: "flying-beetle",
    description: "It crawled out of the waste. It hums.",
    likes: [],
    behaviour: { kind: "eat", reach: 1 },
    weight: 0,
    hp: 1,
    drops: [
        { itemId: "isotope", chance: 1, quantity: { min: 1, max: 1 } },
        { itemId: "golden-scarab", chance: 0.05, quantity: { min: 1, max: 1 } },
    ],
    xp: 12,
    bounty: 4,
} satisfies Pest;
