import type { Enemy } from "#geo/models";

export default {
    id: "spider",
    name: "Giant Spider",
    sprite: "spider",
    tier: 1,
    stats: { maxHealth: 16, attack: 9, defense: 0, speed: 11 },
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
    coins: { min: 1, max: 2 },
    xp: 40,
} satisfies Enemy;
