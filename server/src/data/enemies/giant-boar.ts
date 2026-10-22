import type { Enemy } from "#geo/models";

export default {
    id: "giant-boar",
    name: "Giant Boar",
    sprite: "giant-boar",
    tier: 5,
    stats: { maxHealth: 12, attack: 7, defense: 0, speed: 9 },
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
    coins: { min: 1, max: 2 },
    xp: 40,
} satisfies Enemy;
