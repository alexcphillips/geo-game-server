import type { Enemy } from "#geo/models";

export default {
    id: "green-slime",
    name: "Green Slime",
    sprite: "green-slime",
    tier: 1,
    stats: { maxHealth: 12, attack: 5, defense: 0, speed: 8 },
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
    coins: { min: 1, max: 1 },
    xp: 20,
} satisfies Enemy;
