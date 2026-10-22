import type { Reforge } from "#geo/models";

// A little attack and a little speed.
export default {
    id: "pure",
    name: "Pure",
    appliesTo: ["armor"],
    modifiers: {
        common: [{ stat: "attack", kind: "flat", value: 1 }, { stat: "speed", kind: "flat", value: 1 }],
        uncommon: [{ stat: "attack", kind: "flat", value: 1 }, { stat: "speed", kind: "flat", value: 1 }],
        rare: [{ stat: "attack", kind: "flat", value: 2 }, { stat: "speed", kind: "flat", value: 1 }],
        epic: [{ stat: "attack", kind: "flat", value: 3 }, { stat: "speed", kind: "flat", value: 2 }],
        legendary: [{ stat: "attack", kind: "flat", value: 4 }, { stat: "speed", kind: "flat", value: 2 }],
    },
} satisfies Reforge;
