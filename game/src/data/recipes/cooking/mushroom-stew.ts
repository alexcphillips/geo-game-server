import type { Recipe } from "#geo/models";

export default {
    id: "mushroom-stew",
    inputs: [{ itemId: "mushrooms", quantity: 3 }],
    output: { itemId: "mushroom-stew", quantity: 1 },
    station: "cooking",
    xp: { skill: "cooking", amount: 10 },
} satisfies Recipe;
