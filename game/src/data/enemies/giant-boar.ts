import type { Enemy } from "#geo/models";

// Tier 1's lesson in intents: Charge always leads to Gore, the hit Guard is
// for. PLACEHOLDER numbers. No sprite yet, so it won't spawn until one is added.
export default {
    id: "giant-boar",
    name: "Giant Boar",
    sprite: "giant-boar",
    tier: 1,
    stats: { maxHealth: 26, attack: 8, defense: 1, speed: 9 },
    moves: [
        {
            id: "bash",
            name: "Bash",
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
            id: "charge",
            name: "Charge",
            weight: 1,
            actions: [],
            next: "gore",
        },
        {
            id: "gore",
            name: "Gore",
            weight: 0,
            actions: [
                {
                    type: "attack",
                    to: "other",
                    amount: { stat: "attack", multiplier: 2.5 },
                    delivery: "melee",
                },
            ],
        },
    ],
    loot: [{ itemId: "bones", chance: 1, quantity: { min: 1, max: 1 } }],
    coins: { min: 1, max: 3 },
    xp: 45,
    habitats: [{ near: "foraging", weight: 30 }],
} satisfies Enemy;
