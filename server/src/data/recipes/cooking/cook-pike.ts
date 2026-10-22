import type { Recipe } from "#geo/models";

export default {
    id: "cook-pike",
    inputs: [{ itemId: "fish.pike", quantity: 1 }],
    output: { itemId: "pike-fillet", quantity: 1 },
    station: "cooking",
    xp: { skill: "cooking", amount: 20 },
} satisfies Recipe;
