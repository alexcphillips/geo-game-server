import type { Enemy } from "#geo/models";

// Tier 1's lesson in statuses: Burning only ticks when its bearer attacks, so
// a burnt player can Guard and let it run out. PLACEHOLDER numbers.
export default {
    id: "fire-ant",
    name: "Fire Ant",
    sprite: "fire-ant",
    tier: 1,
    stats: { maxHealth: 18, attack: 8, defense: 0, speed: 11 },
    moves: [
        {
            id: "bite",
            name: "Bite",
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
            id: "fire-bite",
            name: "Fire Bite",
            weight: 1,
            actions: [
                {
                    type: "attack",
                    to: "other",
                    amount: { stat: "attack", multiplier: 0.6 },
                    element: "fire",
                    delivery: "melee",
                },
                { type: "applyStatus", to: "other", status: "burning" },
            ],
        },
    ],
    loot: [{ itemId: "tiny-ember", chance: 0.6, quantity: { min: 1, max: 1 } }],
    coins: { min: 1, max: 3 },
    xp: 45,
    habitats: [{ near: "farming", weight: 30 }],
} satisfies Enemy;
