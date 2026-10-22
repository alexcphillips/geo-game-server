import type { Recipe } from "#geo/models";

// An endgame farming card: crafted from mutations and rare drops, never sold.
export default {
    id: "card-exterminators-oath",
    inputs: [{ itemId: "veil-shard", quantity: 2 }, { itemId: "mouse-tail", quantity: 10 }],
    output: { itemId: "card.farm.exterminators-oath", quantity: 1 },
} satisfies Recipe;
