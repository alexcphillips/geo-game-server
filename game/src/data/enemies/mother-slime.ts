import type { Enemy } from "#geo/models";

// Slime Pits' boss; dungeon-only (no habitats, not in config/spawns). Tuned
// by simulation (2000 fights per case from full health, best attack each
// turn, eating bread at 30 health): the starter kit never wins; Slime Grip
// Wraps alone win ~23%; wraps plus one defense piece (Ragged Pants) always
// win (all with the starting Plank Shield). Slimeling Swarm, its most common
// move, is four light hits that defense blunts, so armor matters more than attack.
export default {
    id: "mother-slime",
    name: "Mother Slime",
    sprite: "mother-slime",
    tier: 1,
    stats: { maxHealth: 64, attack: 12, defense: 2, speed: 11 },
    moves: [
        {
            id: "bite",
            name: "Bite",
            weight: 2,
            actions: [{ type: "attack", to: "other", amount: { stat: "attack" }, delivery: "melee" }],
        },
        {
            id: "slimeling-swarm",
            name: "Slimeling Swarm",
            weight: 3,
            actions: [{ type: "attack", to: "other", amount: { stat: "attack", multiplier: 0.4 }, hits: 4, delivery: "melee" }],
        },
    ],
    loot: [{ itemId: "slime", chance: 1, quantity: { min: 2, max: 4 } }],
    coins: { min: 8, max: 15 },
    xp: 150,
} satisfies Enemy;
