import type { Enemy } from "#geo/models";

export default {
    id: "crystal-golem",
    name: "Crystal Golem",
    sprite: "crystal-golem",
    tier: 5,
    stats: { maxHealth: 40, attack: 12, defense: 0, speed: 12 },
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
    loot: [{ itemId: "slime", chance: 1, quantity: { min: 1, max: 1 } }],
    coins: { min: 1, max: 3 },
    xp: 40,
    habitats: [{ near: "mining", weight: 20 }],
} satisfies Enemy;
