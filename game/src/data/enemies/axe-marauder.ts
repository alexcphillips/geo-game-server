import type { Enemy } from "#geo/models";

export default {
    id: "axe-marauder",
    name: "Axe Marauder",
    sprite: "axe-marauder",
    tier: 5,
    stats: { maxHealth: 33, attack: 19, defense: 2, speed: 13 },
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
