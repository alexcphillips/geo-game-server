import type { Dungeon } from "#geo/models";

// PLACEHOLDER enemies and loot until the dungeon gets its own; the boss is
// its own (data/enemies/mother-slime.ts).
export default {
    id: "slime-pits",
    name: "Slime Pits",
    description: "Something huge has settled at the bottom of the pits, and the slimes keep coming from it.",
    boss: "mother-slime",
    requiredLevel: 0,
    maxPlayers: 4,

    // Small and quick: one star room, no gold room.
    stars: 1,
    encounterEnemies: ["green-slime"],
    // PLACEHOLDER: a beefier slime once there is one at this tier.
    starEnemies: ["green-slime"],
    roomStyle: "slime-pool",
    rooms: {
        den: { kind: "boss", name: "Mother's Den", style: "boss-den" },
        "sluice-gate": { kind: "encounter", name: "Sluice Gate", lock: "sluice-key", style: "sluice" },
    },
    // PLACEHOLDER loot until the dungeon gets its own items.
    roomLoot: [
        { rolls: { min: 1, max: 1 }, entries: [{ itemId: "slime", weight: 1, quantity: { min: 2, max: 4 } }] },
        { rolls: { min: 0, max: 1 }, entries: [{ itemId: "bread", weight: 1, quantity: { min: 1, max: 1 } }] },
    ],
    chests: {
        plain: [{ rolls: { min: 1, max: 1 }, entries: [{ itemId: "slime", weight: 1, quantity: { min: 3, max: 6 } }] }],
        gold: [{ rolls: { min: 2, max: 3 }, entries: [{ itemId: "slime", weight: 1, quantity: { min: 3, max: 6 } }] }],
        ruby: [
            { rolls: { min: 2, max: 3 }, entries: [{ itemId: "slime", weight: 1, quantity: { min: 4, max: 8 } }] },
            { rolls: { min: 1, max: 1 }, entries: [{ itemId: "ember-ring", weight: 1, quantity: { min: 1, max: 1 } }] },
        ],
        void: [
            { rolls: { min: 3, max: 4 }, entries: [{ itemId: "slime", weight: 1, quantity: { min: 5, max: 10 } }] },
            { rolls: { min: 1, max: 1 }, entries: [{ itemId: "crystal-eye", weight: 1, quantity: { min: 1, max: 1 } }] },
        ],
    },
    pool: [
        { room: "encounter", weight: 3 },
        { room: "loot", weight: 1 },
        { room: "event", weight: 1, max: 1 },
    ],
} satisfies Dungeon;
