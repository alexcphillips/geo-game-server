import type { Enemy } from "#geo/models";

export default {
    id: "shield-fighter",
    name: "Shield Fighter",
    sprite: "shield-fighter",
    tier: 5,
    stats: { maxHealth: 24, attack: 12, defense: 1, speed: 9 },
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
