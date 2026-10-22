import type { Reforge } from "#geo/models";

// Quicker on your feet, a little less defense.
export default {
    id: "light",
    name: "Light",
    appliesTo: ["armor"],
    modifiers: {
        common: [{ stat: "speed", kind: "flat", value: 1 }, { stat: "defense", kind: "flat", value: -1 }],
        uncommon: [{ stat: "speed", kind: "flat", value: 2 }, { stat: "defense", kind: "flat", value: -1 }],
        rare: [{ stat: "speed", kind: "flat", value: 3 }, { stat: "defense", kind: "flat", value: -2 }],
        epic: [{ stat: "speed", kind: "flat", value: 4 }, { stat: "defense", kind: "flat", value: -2 }],
        legendary: [{ stat: "speed", kind: "flat", value: 5 }, { stat: "defense", kind: "flat", value: -3 }],
    },
} satisfies Reforge;
