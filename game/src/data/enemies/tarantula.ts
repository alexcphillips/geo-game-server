import type { Enemy } from "#geo/models";

export default {
    id: "tarantula",
    name: "Giant Tarantula",
    sprite: "tarantula",
    tier: 2,
    stats: { maxHealth: 32, attack: 20, defense: 0, speed: 13 },
    moves: [
        {
            id: "bite",
            name: "Bite",
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
            id: "paralyzing-bite",
            name: "Paralyzing Bite",
            weight: 1,
            actions: [
                {
                    type: "attack",
                    to: "other",
                    amount: { stat: "attack", multiplier: 0.6 },
                    delivery: "melee",
                },
                { type: "applyStatus", to: "other", status: "paralyzed" },
            ],
        },
    ],
    loot: [
        { itemId: "spider-fang", chance: 1, quantity: { min: 1, max: 2 } },
        { itemId: "silk-spool", chance: 0.5, quantity: { min: 1, max: 2 } },
        // PLACEHOLDER rate: the rare drop that starts a Tarantula.
        {
            itemId: "pet.tarantula.common",
            chance: 0.01,
            quantity: { min: 1, max: 1 },
        },
    ],
    coins: { min: 1, max: 3 },
    xp: 80,
} satisfies Enemy;
