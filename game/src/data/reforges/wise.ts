import type { Reforge } from "#geo/models";

// Intelligence, for cards that scale off it.
export default {
    id: "wise",
    name: "Wise",
    appliesTo: ["armor"],
    modifiers: {
        common: [{ stat: "intelligence", kind: "flat", value: 3 }],
        uncommon: [{ stat: "intelligence", kind: "flat", value: 5 }],
        rare: [{ stat: "intelligence", kind: "flat", value: 8 }],
        epic: [{ stat: "intelligence", kind: "flat", value: 12 }],
        legendary: [{ stat: "intelligence", kind: "flat", value: 18 }],
    },
} satisfies Reforge;
