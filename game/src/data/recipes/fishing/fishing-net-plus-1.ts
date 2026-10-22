import type { Recipe } from "#geo/models";

export default {
    id: "fishing-net-plus-1",
    inputs: [{ itemId: "silk-spool", quantity: 10 }, { itemId: "fishing-net", quantity: 1 }],
    output: { itemId: "fishing-net-plus-1", quantity: 1 },
    skills: [{ skill: "fishing", level: 5 }],
} satisfies Recipe;
