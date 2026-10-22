import type { Enemy } from "#geo/models";

// Slime Pits' boss; dungeon-only (no habitats, not in config/spawns). Tuned
// by simulation (300 fights per case, eating bread at 30 health): the
// starter kit never wins, even at full health with its best play; a
// Venomfang Dagger and one armor piece win from 65 health with its worst
// play; Venomfang alone usually loses. Defense 2 is what the bronze dagger
// can't get through, and Slimeling Swarm's four light hits are what armor blunts.
export default {
    id: "mother-slime",
    name: "Mother Slime",
    sprite: "mother-slime",
    tier: 1,
    stats: { maxHealth: 60, attack: 10, defense: 2, speed: 11 },
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
            weight: 1,
            actions: [{ type: "attack", to: "other", amount: { stat: "attack", multiplier: 0.4 }, hits: 4, delivery: "melee" }],
        },
    ],
    loot: [{ itemId: "slime", chance: 1, quantity: { min: 2, max: 4 } }],
    coins: { min: 8, max: 15 },
    xp: 150,
} satisfies Enemy;
