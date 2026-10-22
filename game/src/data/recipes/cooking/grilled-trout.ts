import type { Recipe } from "#geo/models";

export default {
    id: "grilled-trout",
    inputs: [{ itemId: "whole-trout", quantity: 1 }],
    output: { itemId: "grilled-trout", quantity: 1 },
    station: "cooking",
    xp: { skill: "cooking", amount: 10 },
} satisfies Recipe;
