import type { Enemy } from "#geo/models";

export default {
    id: "bandit",
    name: "Bandit",
    sprite: "bandit",
    tier: 1,
    stats: { maxHealth: 30, attack: 13, defense: 2, speed: 11 },
    moves: [
        {
            id: "slash",
            name: "Slash",
            weight: 2,
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
            // Three light cuts: brutal unarmored, weak against Defense.
            id: "flurry",
            name: "Flurry",
            weight: 1,
            actions: [
                {
                    type: "attack",
                    to: "other",
                    amount: { stat: "attack", multiplier: 0.45 },
                    hits: 3,
                    delivery: "melee",
                },
            ],
        },
    ],
    loot: [
        { itemId: "plank-shield", chance: 0.2, quantity: { min: 1, max: 1 } },
        { itemId: "ragged-pants", chance: 0.2, quantity: { min: 1, max: 1 } },
        { itemId: "bones", chance: 1, quantity: { min: 1, max: 1 } },
    ],
    habitats: [{ near: "landmark", weight: 10 }],
    coins: { min: 1, max: 3 },
    xp: 70,
} satisfies Enemy;
