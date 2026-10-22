import type { Recipe } from "#geo/models";

export default {
    id: "cook-musky",
    inputs: [{ itemId: "fish.musky", quantity: 1 }],
    output: { itemId: "musky-steak", quantity: 1 },
    skills: [{ skill: "cooking", level: 6 }],
    station: "cooking",
    xp: { skill: "cooking", amount: 100 },
} satisfies Recipe;
