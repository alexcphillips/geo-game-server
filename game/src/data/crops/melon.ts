import type { Crop } from "#geo/models";

// PLACEHOLDER numbers. Slow and greedy: leaves its tile poor.
export default {
    id: "melon",
    name: "Melon",
    icon: "watermelon",
    seed: "melon-seeds",
    produce: "melon",
    stages: 5,
    yield: { min: 2, max: 3 },
    seedsBack: { min: 1, max: 2 },
    xp: 20,
} satisfies Crop;
