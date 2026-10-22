import type { Enemy } from "#geo/models";

// PLACEHOLDER numbers and art. A sea creature: never spawns on the map, only
// bites on a fishing line (config/fishing.ts seaCreatures).
export default {
    id: "kraken",
    name: "Kraken",
    sprite: "placeholder-red",
    tier: 5,
    stats: { maxHealth: 65, attack: 11, defense: 0, speed: 7 },
    moves: [
        {
            id: "tentacle-lash",
            name: "Tentacle Lash",
            weight: 3,
            actions: [{ type: "attack", to: "other", amount: { stat: "attack" }, delivery: "melee" }],
        },
        {
            id: "crushing-grip",
            name: "Crushing Grip",
            weight: 1,
            actions: [{ type: "attack", to: "other", amount: { stat: "attack", multiplier: 0.6 }, hits: 2, delivery: "melee" }],
        },
        {
            id: "ink-cloud",
            name: "Ink Cloud",
            weight: 1,
            actions: [{ type: "guard", to: "self", amount: 8 }],
        },
    ],
    loot: [
        { itemId: "kraken-ink", chance: 1, quantity: { min: 1, max: 1 } },
        { itemId: "eel-gel", chance: 0.5, quantity: { min: 2, max: 2 } },
    ],
    coins: { min: 8, max: 15 },
    xp: 120,
} satisfies Enemy;
