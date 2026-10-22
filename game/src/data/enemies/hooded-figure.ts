import type { Enemy } from "#geo/models";

export default {
    id: "hooded-figure",
    name: "Hooded Figure",
    sprite: "hooded-figure",
    tier: 5,
    stats: { maxHealth: 32, attack: 16, defense: 1, speed: 14 },
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
