import type { Quest } from "#geo/models";

// Teaches camp and the bank: a defeat takes every coin carried, banked ones are safe.
export default {
    id: "rainy-day-fund",
    title: "Rainy Day Fund",
    after: ["slime-cull"],
    objectives: [
        { id: "camp", type: "camp", count: 1 },
        { id: "deposit", type: "deposit", count: 10 },
    ],
    // PLACEHOLDER
    rewards: { coins: 10 },
} satisfies Quest;
