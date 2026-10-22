import type { Crop } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "potato",
    name: "Potato",
    icon: "potato",
    seed: "seed-potato",
    produce: "potato",
    stages: 3,
    yield: { min: 2, max: 4 },
    seedsBack: { min: 1, max: 1 },
    xp: 8,
} satisfies Crop;
