import type { Recipe } from "#geo/models";

export default {
    id: "shellbreaker-ring",
    inputs: [
        { itemId: "sturdy-shell", quantity: 10 },
        { itemId: "shiny-shell", quantity: 4 },
    ],
    output: { itemId: "shellbreaker-ring", quantity: 1 },
} satisfies Recipe;
