import type { Quest } from "#geo/models";

// Teaches fishing and cooking, and so the lunchbox. PLACEHOLDER fish: salmon
// is common, so the Twig starter rod can catch it; swap in whichever low-tier
// fish it ends up being.
export default {
    id: "fresh-off-the-fire",
    title: "Fresh off the Fire",
    after: ["rainy-day-fund"],
    objectives: [{ id: "cook", type: "craft", recipe: "cook-salmon", count: 1 }],
    // PLACEHOLDER
    rewards: { coins: 15 },
} satisfies Quest;
