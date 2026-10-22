import type { Enemy } from "#geo/models";

// DEV ONLY, for testing defeat: kills you before your first card. Only via the admin menu's dev
// spawn.
export default {
    id: "test-dragon",
    name: "Test Dragon",
    sprite: "placeholder-red",
    tier: 5,
    leavesAfterWinning: true,
    stats: { maxHealth: 999, attack: 999, defense: 0, speed: 99 },
    moves: [
        {
            id: "crush",
            name: "Crush",
            weight: 1,
            actions: [{ type: "attack", to: "other", amount: { stat: "attack" }, delivery: "melee" }],
        },
    ],
    loot: [],
    xp: 0,
} satisfies Enemy;
