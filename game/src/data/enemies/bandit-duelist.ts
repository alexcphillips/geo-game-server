import type { Enemy } from "#geo/models";

export default {
    id: "bandit-duelist",
    name: "Bandit Duelist",
    sprite: "bandit-duelist",
    tier: 5,
    stats: {
        maxHealth: 29,
        attack: 17,
        defense: 3,
        speed: 12,
        counterChance: 0.25,
    },
    moves: [
        {
            id: "bite",
            name: "Bite",
            weight: 1,
            actions: [
                {
                    type: "attack",
                    to: "other",
                    amount: { stat: "attack" },
                    delivery: "melee",
                },
            ],
        },
    ],
    loot: [
        { itemId: "spider-fang", chance: 1, quantity: { min: 1, max: 1 } },
        { itemId: "silk-spool", chance: 0.5, quantity: { min: 1, max: 1 } },
    ],
    coins: { min: 1, max: 4 },
    xp: 40,
} satisfies Enemy;
