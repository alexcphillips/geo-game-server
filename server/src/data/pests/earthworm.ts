import type { Pest } from "#geo/models";

// PLACEHOLDER numbers. Saps the crop it's on; doesn't eat or breed.
export default {
    id: "earthworm",
    name: "Earthworm",
    icon: "earth-worm",
    description: "It doesn't eat the crop. It just sits in the roots until nothing grows.",
    likes: ["melon", "carrot"],
    behaviour: { kind: "sap" },
    weight: 1,
    drops: [
        { itemId: "worm-castings", chance: 1, quantity: { min: 1, max: 2 } },
        { itemId: "golden-scarab", chance: 0.03, quantity: { min: 1, max: 1 } },
    ],
    xp: 5,
    bounty: 1,
} satisfies Pest;
