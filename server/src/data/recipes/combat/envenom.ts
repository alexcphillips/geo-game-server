import type { Recipe } from "#geo/models";

export default {
    id: "envenom",
    inputs: [{ itemId: "spider-fang", quantity: 10 }],
    output: { itemId: "card.envenom", quantity: 1 },
    skills: [{ skill: "combat", level: 3 }],
} satisfies Recipe;
