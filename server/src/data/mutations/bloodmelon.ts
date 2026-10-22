import type { Mutation } from "#geo/models";

// PLACEHOLDER numbers. Recipe: two ripe melons, during a Blood Moon, with a Pond beside the empty tile.
export default {
    id: "bloodmelon",
    name: "Bloodmelon",
    icon: "hypersonic-melon",
    description: "Red to the rind, and warm to the touch.",
    produce: "bloodmelon",
    stages: 5,
    yield: { min: 1, max: 2 },
    xp: 90,
    recipe: { parents: [{ cropId: "melon", count: 2 }], event: "blood-moon", structure: "pond" },
    chance: 0.2,
    research: { coins: 500, xp: 120 },
} satisfies Mutation;
