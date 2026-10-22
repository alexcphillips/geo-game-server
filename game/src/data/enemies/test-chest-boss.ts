import type { Enemy } from "#geo/models";

// DEV ONLY, for testing chests: a soft fight that always gives a chest selection. Never spawns on
// its own.
export default {
    id: "test-chest-boss",
    name: "Test Hoarder",
    sprite: "placeholder-red",
    tier: 5,
    stats: { maxHealth: 30, attack: 4, defense: 0, speed: 5 },
    moves: [
        {
            id: "swipe",
            name: "Swipe",
            weight: 1,
            actions: [{ type: "attack", to: "other", amount: { stat: "attack" }, delivery: "melee" }],
        },
    ],
    loot: [{ itemId: "bones", chance: 1, quantity: { min: 1, max: 1 } }],
    chests: {
        chance: 1,
        offers: [
            {
                tier: "plain",
                chance: 1,
                pools: [
                    {
                        rolls: { min: 1, max: 2 },
                        entries: [
                            { itemId: "bones", weight: 3, quantity: { min: 2, max: 5 } },
                            { itemId: "spider-fang", weight: 2, quantity: { min: 1, max: 2 } },
                            { itemId: "silk-spool", weight: 1, quantity: { min: 1, max: 1 } },
                        ],
                    },
                ],
            },
            {
                tier: "gold",
                chance: 1,
                pools: [
                    {
                        rolls: { min: 1, max: 1 },
                        entries: [
                            { itemId: "silk-spool", weight: 2, quantity: { min: 2, max: 3 } },
                            { itemId: "gold-ore", weight: 2, quantity: { min: 1, max: 3 } },
                            { itemId: "emerald-band", weight: 1, quantity: { min: 1, max: 1 } },
                        ],
                    },
                    {
                        rolls: { min: 1, max: 2 },
                        entries: [
                            { itemId: "bones", weight: 1, quantity: { min: 3, max: 6 } },
                            { itemId: "spider-fang", weight: 1, quantity: { min: 2, max: 3 } },
                        ],
                    },
                ],
            },
            {
                tier: "ruby",
                chance: 0.5,
                pools: [
                    {
                        rolls: { min: 1, max: 1 },
                        entries: [
                            { itemId: "ruby", weight: 3, quantity: { min: 1, max: 2 } },
                            { itemId: "ember-ring", weight: 1, quantity: { min: 1, max: 1 } },
                            { itemId: "venomfang-dagger", weight: 1, quantity: { min: 1, max: 1 } },
                        ],
                    },
                    {
                        rolls: { min: 2, max: 3 },
                        entries: [
                            { itemId: "gold-ore", weight: 1, quantity: { min: 2, max: 4 } },
                            { itemId: "silk-spool", weight: 1, quantity: { min: 2, max: 4 } },
                        ],
                    },
                ],
            },
            {
                tier: "void",
                chance: 0.25,
                pools: [
                    {
                        rolls: { min: 1, max: 1 },
                        entries: [
                            { itemId: "crown-of-ash", weight: 1, quantity: { min: 1, max: 1 } },
                            { itemId: "titanium-ore", weight: 2, quantity: { min: 3, max: 6 } },
                            { itemId: "ruby", weight: 2, quantity: { min: 3, max: 5 } },
                        ],
                    },
                    {
                        rolls: { min: 2, max: 4 },
                        entries: [
                            { itemId: "ruby", weight: 1, quantity: { min: 1, max: 2 } },
                            { itemId: "gold-ore", weight: 2, quantity: { min: 3, max: 6 } },
                        ],
                    },
                ],
            },
        ],
    },
    coins: { min: 20, max: 40 },
    xp: 60,
} satisfies Enemy;
