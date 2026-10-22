import type { Crop } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "pumpkin",
    name: "Pumpkin",
    icon: "pumpkin",
    seed: "pumpkin-seeds",
    produce: "pumpkin",
    stages: 4,
    yield: { min: 1, max: 2 },
    seedsBack: { min: 1, max: 2 },
    xp: 14,
} satisfies Crop;
