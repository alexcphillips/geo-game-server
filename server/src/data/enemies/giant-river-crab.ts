import type { Enemy } from "#geo/models";

export default {
    id: "giant-river-crab",
    name: "Giant River Crab",
    sprite: "giant-river-crab",
    tier: 1,
    stats: { maxHealth: 22, attack: 13, defense: 3, speed: 8 },
    moves: [
        {
            id: "pinch",
            name: "Pinch",
            weight: 4,
            actions: [
                {
                    type: "attack",
                    to: "other",
                    amount: { stat: "attack" },
                    delivery: "melee",
                },
            ],
        },
        {
            id: "shell-up",
            name: "Shell Up",
            weight: 1,
            actions: [{ type: "applyStatus", to: "self", status: "shelled" }],
        },
    ],
    loot: [
        { itemId: "sturdy-shell", chance: 0.5, quantity: { min: 1, max: 1 } },
        { itemId: "shiny-shell", chance: 0.1, quantity: { min: 1, max: 1 } },
        {
            itemId: "digested-shrimp",
            chance: 0.05,
            quantity: { min: 1, max: 1 },
        },
    ],
    coins: { min: 2, max: 4 },
    xp: 55,
    habitats: [{ near: "water", weight: 40 }],
} satisfies Enemy;
