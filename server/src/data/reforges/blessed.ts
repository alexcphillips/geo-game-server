import type { Reforge } from "#geo/models";

// Mending: heals you receive are bigger (not food's).
export default {
    id: "blessed",
    name: "Blessed",
    appliesTo: ["armor"],
    modifiers: {
        common: [{ stat: "mending", kind: "flat", value: 0.05 }],
        uncommon: [{ stat: "mending", kind: "flat", value: 0.05 }],
        rare: [{ stat: "mending", kind: "flat", value: 0.1 }],
        epic: [{ stat: "mending", kind: "flat", value: 0.15 }],
        legendary: [{ stat: "mending", kind: "flat", value: 0.2 }],
    },
} satisfies Reforge;
