import type { Enemy } from "#geo/models";

export default {
    id: "wizard-crab",
    name: "Wizard Crab",
    sprite: "wizard-crab",
    tier: 5,
    stats: { maxHealth: 22, attack: 8, defense: 3, speed: 10 },
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
