import type { FarmingConfig } from "#geo/models";

// PLACEHOLDER numbers throughout, until a balance pass.
export default {
    turnHours: 12,
    maxTurnsAway: 2,
    startSize: 3,
    // The first 3 tiles bought are coins only, so a new farm can grow before it has a Compost Bin going.
    unlockCost: { first: 50, step: 25, compost: 1, compostFrom: 3, itemId: "compost" },
    rotChances: [0.1, 0.2, 0.35, 0.5],
    waste: { spreadChance: 0.15, mutationBoost: 3, pestChance: 0.1, pest: "glow-beetle" },
    shrine: {
        halfValue: 400,
        curseShare: 0.25,
        blessings: [
            { id: "growth", name: "Blessing of Growth", description: "Every growing crop grows an extra stage on the next cycle.", turns: 1, weight: 3, curse: false },
            { id: "plenty", name: "Blessing of Plenty", description: "+1 yield on every harvest.", turns: 3, weight: 3, curse: false },
            { id: "mutation", name: "Blessing of Change", description: "Mutation chances ×2.", turns: 3, weight: 2, curse: false },
            { id: "pests", name: "Curse of Hunger", description: "Pests come twice as often, and sooner.", turns: 2, weight: 1, curse: true },
        ],
    },
    pests: { fromTurn: 3, chancePerCrop: 0.08, maxChance: 0.6, max: 4 },
    pollinateBoost: 2,
    // Each cycle in a row a mutation's recipe holds on a tile without sprouting adds this to its chance there.
    mutationRamp: 0.25,
    events: { fromTurn: 2, chance: 0.2 },
    orders: { perWeek: 3, value: { min: 120, max: 400 }, rewardMultiplier: 2.5, depositShare: 0.2 },
    contests: { prizes: [1500, 1000, 600], participation: 100 },
    pesthunter: {
        shop: [
            { itemId: "card.farm.bait-ring", price: 3 },
            { itemId: "card.farm.snap-trap", price: 3 },
            { itemId: "card.farm.smoke", price: 6 },
            { itemId: "golden-scarab", price: 10 },
            { itemId: "card.farm.exterminators-oath", price: 20 },
        ],
    },
    globalEvents: [
        { eventId: "blood-moon", days: 2, weight: 1 },
        { eventId: "meteor-shower", days: 1, weight: 1 },
    ],
    weatherWeights: { clear: 7, rain: 3, heatwave: 1, frost: 0.5 },
} satisfies FarmingConfig;
