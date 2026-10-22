import type { Enemy } from "#geo/models";

export default {
    id: "leafcutter-ant",
    name: "Leafcutter Ant",
    sprite: "leafcutter-ant",
    tier: 5,
    stats: { maxHealth: 18, attack: 15, defense: 1, speed: 11 },
    moves: [
        {
            id: "bite",
            name: "Bite",
            weight: 1,
            actions: [
                // add a leaf ability that applies a barrier to this
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
