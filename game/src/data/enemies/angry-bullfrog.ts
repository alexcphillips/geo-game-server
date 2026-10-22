import type { Enemy } from "#geo/models";

export default {
    id: "angry-bullfrog",
    name: "Angry Bullfrog",
    sprite: "angry-bullfrog",
    tier: 5,
    stats: { maxHealth: 22, attack: 8, defense: 1, speed: 7 },
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
