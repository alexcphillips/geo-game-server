import type { Mutation } from "#geo/models";

// PLACEHOLDER numbers. Recipe: Two ripe wheat beside an empty tile on a Heatwave, on dry ground (no Well, Pond or bog near).
export default {
    id: "emberwheat",
    name: "Emberwheat",
    icon: "flamed-leaf",
    description: "Wheat that came through a heatwave still smouldering.",
    produce: "emberwheat",
    stages: 3,
    yield: { min: 1, max: 2 },
    xp: 40,
    recipe: { parents: [{ cropId: "wheat", count: 2 }], weather: "heatwave", ground: "dry" },
    chance: 0.25,
    research: { coins: 200, xp: 60 },
} satisfies Mutation;
