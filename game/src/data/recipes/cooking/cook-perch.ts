import type { Recipe } from "#geo/models";

export default {
    id: "cook-perch",
    inputs: [{ itemId: "fish.perch", quantity: 1 }],
    output: { itemId: "grilled-perch", quantity: 1 },
    station: "cooking",
    xp: { skill: "cooking", amount: 10 },
} satisfies Recipe;
