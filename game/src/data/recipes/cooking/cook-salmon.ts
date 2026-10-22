import type { Recipe } from "#geo/models";

export default {
    id: "cook-salmon",
    inputs: [{ itemId: "fish.salmon", quantity: 1 }],
    output: { itemId: "grilled-salmon", quantity: 1 },
    station: "cooking",
    xp: { skill: "cooking", amount: 10 },
} satisfies Recipe;
