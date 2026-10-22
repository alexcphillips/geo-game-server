import type { Recipe } from "#geo/models";

export default {
    id: "cook-catfish",
    inputs: [{ itemId: "fish.catfish", quantity: 1 }],
    output: { itemId: "blackened-catfish", quantity: 1 },
    skills: [{ skill: "cooking", level: 3 }],
    station: "cooking",
    xp: { skill: "cooking", amount: 45 },
} satisfies Recipe;
