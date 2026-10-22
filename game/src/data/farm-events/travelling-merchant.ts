import type { FarmEvent } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "travelling-merchant",
    name: "Travelling Merchant",
    icon: "swap-bag",
    description: "A cart at the gate, for one cycle only.",
    weight: 2,
    effect: {
        kind: "merchant",
        count: 2,
        stock: [
            { itemId: "card.farm.hand-pollinate", price: 90 },
            { itemId: "card.farm.smoke", price: 70 },
            { itemId: "card.farm.ripen", price: 90 },
            { itemId: "golden-scarab", price: 120 },
            { itemId: "melon-seeds", price: 6 },
        ],
    },
} satisfies FarmEvent;
