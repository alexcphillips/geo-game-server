import type { Pest } from "#geo/models";

// PLACEHOLDER numbers. Eats a crop on its tile or one step away (diagonals too).
export default {
    id: "field-mouse",
    name: "Field Mouse",
    icon: "mouse",
    description: "Quick, hungry, and fond of anything round and starchy.",
    likes: ["potato", "pumpkin"],
    behaviour: { kind: "eat", reach: 1 },
    weight: 1,
    drops: [
        { itemId: "mouse-tail", chance: 1, quantity: { min: 1, max: 2 } },
        { itemId: "golden-scarab", chance: 0.03, quantity: { min: 1, max: 1 } },
    ],
    xp: 6,
    bounty: 2,
} satisfies Pest;
