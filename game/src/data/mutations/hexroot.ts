import type { Mutation } from "#geo/models";

// PLACEHOLDER numbers. Recipe: two ripe potatoes beside an empty tile while the Shrine's Curse of Hunger is on the farm.
export default {
    id: "hexroot",
    name: "Hexroot",
    icon: "plant-roots",
    description: "It grew the wrong way, on purpose.",
    produce: "hexroot",
    stages: 3,
    yield: { min: 1, max: 2 },
    xp: 60,
    recipe: { parents: [{ cropId: "potato", count: 2 }], blessing: "pests" },
    chance: 0.3,
    research: { coins: 300, xp: 80 },
} satisfies Mutation;
