import type { Crop } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "carrot",
    name: "Carrot",
    icon: "carrot",
    seed: "carrot-seeds",
    produce: "carrot",
    stages: 3,
    yield: { min: 2, max: 4 },
    seedsBack: { min: 1, max: 2 },
    xp: 6,
} satisfies Crop;
