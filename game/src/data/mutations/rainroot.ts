import type { Mutation } from "#geo/models";

// PLACEHOLDER numbers. Recipe: Ripe carrot and potato around an empty tile, in Rain.
export default {
    id: "rainroot",
    name: "Rainroot",
    icon: "plant-roots",
    description: "A root that grew sideways looking for more rain.",
    produce: "rainroot",
    stages: 3,
    yield: { min: 1, max: 2 },
    xp: 45,
    recipe: { parents: [{ cropId: "carrot", count: 1 }, { cropId: "potato", count: 1 }], weather: "rain" },
    chance: 0.25,
    research: { coins: 220, xp: 60 },
} satisfies Mutation;
