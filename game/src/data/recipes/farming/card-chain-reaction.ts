import type { Recipe } from "#geo/models";

// An endgame farming card: crafted from mutations and rare drops, never sold.
export default {
    id: "card-chain-reaction",
    inputs: [{ itemId: "isotope", quantity: 4 }, { itemId: "stardust", quantity: 2 }],
    output: { itemId: "card.farm.chain-reaction", quantity: 1 },
} satisfies Recipe;
