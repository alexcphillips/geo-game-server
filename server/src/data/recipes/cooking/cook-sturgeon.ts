import type { Recipe } from "#geo/models";

export default {
    id: "cook-sturgeon",
    inputs: [{ itemId: "fish.sturgeon", quantity: 1 }],
    output: { itemId: "smoked-sturgeon", quantity: 1 },
    skills: [{ skill: "cooking", level: 3 }],
    station: "cooking",
    xp: { skill: "cooking", amount: 45 },
} satisfies Recipe;
