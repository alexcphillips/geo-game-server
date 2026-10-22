import type { Enemy } from "#geo/models";

export default {
    id: "trap-jaw-ant",
    name: "Trap-Jaw Ant",
    sprite: "trap-jaw-ant",
    tier: 5,
    stats: { maxHealth: 20, attack: 14, defense: 2, speed: 10 },
    moves: [
        {
            id: "bite",
            name: "Bite",
            weight: 1,
            actions: [
                // should get a move that can stun
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
