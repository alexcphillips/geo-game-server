import type { Dungeon } from "#geo/models";

// PLACEHOLDER: a stand-in until dungeons get their own bosses.
export default {
    id: "magma-vent",
    name: "Magma Vent",
    description: "Heat pours from a crack in the ground, and the slime that lives there has grown fat on it.",
    boss: "magma-slime",
    bossModifiers: [
        { stat: "maxHealth", kind: "percent", value: 3 },
        { stat: "attack", kind: "percent", value: 0.75 },
        { stat: "defense", kind: "flat", value: 4 },
    ],
    requiredLevel: 12,
    maxPlayers: 4,
} satisfies Dungeon;
