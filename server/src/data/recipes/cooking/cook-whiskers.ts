import type { Recipe } from "#geo/models";

export default {
    id: "cook-whiskers",
    inputs: [{ itemId: "fish.whiskers", quantity: 1 }],
    output: { itemId: "whiskers-feast", quantity: 1 },
    skills: [{ skill: "cooking", level: 10 }],
    station: "cooking",
    xp: { skill: "cooking", amount: 250 },
} satisfies Recipe;
