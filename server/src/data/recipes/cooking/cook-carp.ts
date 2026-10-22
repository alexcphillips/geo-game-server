import type { Recipe } from "#geo/models";

export default {
    id: "cook-carp",
    inputs: [{ itemId: "fish.carp", quantity: 1 }],
    output: { itemId: "baked-carp", quantity: 1 },
    station: "cooking",
    xp: { skill: "cooking", amount: 20 },
} satisfies Recipe;
