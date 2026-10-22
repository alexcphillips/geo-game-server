import type { Enemy } from "#geo/models";

export default {
    id: "hundredlegs",
    name: "Hundredlegs",
    sprite: "hundredlegs",
    tier: 5,
    stats: { maxHealth: 58, attack: 23, defense: 3, speed: 15 },
    moves: [
        {
            id: "bash",
            name: "Bash",
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
    loot: [{ itemId: "slime", chance: 1, quantity: { min: 1, max: 1 } }],
    coins: { min: 2, max: 4 },
    xp: 40,
} satisfies Enemy;
