import type { Mutation } from "#geo/models";

// PLACEHOLDER numbers. Recipe: A ripe pumpkin, with a Field Mouse on or next to the empty tile.
export default {
    id: "grinning-gourd",
    name: "Grinning Gourd",
    icon: "pumpkin-lantern",
    description: "Something nibbled a face into it while it grew. It's still smiling.",
    produce: "grinning-gourd",
    stages: 4,
    yield: { min: 1, max: 1 },
    xp: 55,
    recipe: { parents: [{ cropId: "pumpkin", count: 1 }], pest: "field-mouse" },
    chance: 0.3,
    research: { coins: 250, xp: 70 },
} satisfies Mutation;
