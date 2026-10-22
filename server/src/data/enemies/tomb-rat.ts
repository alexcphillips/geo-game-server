import type { Enemy } from "#geo/models";

export default {
    id: "tomb-rat",
    name: "Tomb Rat",
    sprite: "tomb-rat",
    tier: 5,
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
    loot: [{ itemId: "bones", chance: 1, quantity: { min: 1, max: 1 } }],
    coins: { min: 1, max: 3 },
    xp: 40,
} satisfies Enemy;
