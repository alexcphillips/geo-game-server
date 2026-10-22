import type { ChestTiersConfig } from "#geo/models";

export default {
    tiers: [
        { id: "plain", name: "Plain Chest", cost: 0 },
        { id: "gold", name: "Gold Chest", cost: 500 },
        { id: "ruby", name: "Ruby Chest", cost: 1500 },
        { id: "void", name: "Void Chest", cost: 5000 },
    ],
} satisfies ChestTiersConfig;
