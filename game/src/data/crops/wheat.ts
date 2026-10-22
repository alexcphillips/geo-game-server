import type { Crop } from "#geo/models";

// PLACEHOLDER numbers. Quick and cheap: the starter crop.
export default {
    id: "wheat",
    name: "Wheat",
    icon: "wheat",
    seed: "wheat-seeds",
    produce: "wheat",
    stages: 2,
    yield: { min: 2, max: 3 },
    seedsBack: { min: 1, max: 2 },
    xp: 4,
} satisfies Crop;
