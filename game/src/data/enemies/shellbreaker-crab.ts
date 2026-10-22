import type { Enemy } from "#geo/models";

export default {
    id: "shellbreaker-crab",
    name: "Shellbreaker Crab",
    sprite: "shellbreaker-crab",
    tier: 5,
    stats: { maxHealth: 42, attack: 9, defense: 5, speed: 9 },
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
