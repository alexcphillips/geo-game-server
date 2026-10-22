import type { WardrobeConfig } from "#geo/models";

// PLACEHOLDER prices: guesses until the economy is balanced.
export default {
    startingSlots: 3,
    maxSlots: 9,
    // 5,000 for the 4th slot, 10,000 for the 5th, ... 30,000 for the 9th.
    slotCost: { first: 5_000, step: 5_000 },
} satisfies WardrobeConfig;
