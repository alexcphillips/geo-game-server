import type { Dungeon } from "#geo/models";

// PLACEHOLDER: a stand-in until dungeons get their own bosses.
export default {
    id: "spider-nest",
    name: "Spider Nest",
    description: "The webs here are thick as rope, and the thing that spun them is waiting.",
    boss: "spider",
    bossModifiers: [
        { stat: "maxHealth", kind: "percent", value: 2.5 },
        { stat: "attack", kind: "percent", value: 0.5 },
    ],
    requiredLevel: 5,
    maxPlayers: 4,
} satisfies Dungeon;
