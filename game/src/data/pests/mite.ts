import type { Pest } from "#geo/models";

// PLACEHOLDER numbers. Stops the crop it's on from growing, and breeds next door every 2 turns.
export default {
    id: "mite",
    name: "Mite",
    icon: "mite",
    description: "One is nothing. Leave it a few days.",
    likes: ["carrot", "wheat"],
    behaviour: { kind: "breed", every: 2 },
    weight: 1,
    drops: [
        { itemId: "mite-dust", chance: 1, quantity: { min: 1, max: 2 } },
        { itemId: "golden-scarab", chance: 0.03, quantity: { min: 1, max: 1 } },
    ],
    xp: 4,
    bounty: 1,
} satisfies Pest;
