import type { Mutation } from "#geo/models";

// PLACEHOLDER numbers. Recipe: Two ripe carrots, with a Mite on or next to the empty tile.
export default {
    id: "sugarroot",
    name: "Sugarroot",
    icon: "beet",
    description: "Mites have been at it, and left it sweeter than they found it.",
    produce: "sugarroot",
    stages: 3,
    yield: { min: 1, max: 2 },
    xp: 50,
    recipe: { parents: [{ cropId: "carrot", count: 2 }], pest: "mite" },
    chance: 0.3,
    research: { coins: 240, xp: 70 },
} satisfies Mutation;
