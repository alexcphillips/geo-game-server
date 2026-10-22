import type { Reforge } from "#geo/models";

// More defense, a little slower.
export default {
    id: "heavy",
    name: "Heavy",
    appliesTo: ["armor"],
    modifiers: {
        common: [{ stat: "defense", kind: "flat", value: 2 }, { stat: "speed", kind: "flat", value: -1 }],
        uncommon: [{ stat: "defense", kind: "flat", value: 3 }, { stat: "speed", kind: "flat", value: -1 }],
        rare: [{ stat: "defense", kind: "flat", value: 5 }, { stat: "speed", kind: "flat", value: -2 }],
        epic: [{ stat: "defense", kind: "flat", value: 7 }, { stat: "speed", kind: "flat", value: -2 }],
        legendary: [{ stat: "defense", kind: "flat", value: 10 }, { stat: "speed", kind: "flat", value: -3 }],
    },
} satisfies Reforge;
