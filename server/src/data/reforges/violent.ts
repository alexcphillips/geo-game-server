import type { Reforge } from "#geo/models";

// A lot of attack.
export default {
    id: "violent",
    name: "Violent",
    appliesTo: ["weapon"],
    modifiers: {
        common: [{ stat: "attack", kind: "flat", value: 3 }],
        uncommon: [{ stat: "attack", kind: "flat", value: 5 }],
        rare: [{ stat: "attack", kind: "flat", value: 8 }],
        epic: [{ stat: "attack", kind: "flat", value: 12 }],
        legendary: [{ stat: "attack", kind: "flat", value: 16 }],
    },
} satisfies Reforge;
