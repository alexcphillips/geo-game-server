import type { Reforge } from "#geo/models";

// Magic Find: +1 = each rare drop (under 5%) 1% likelier.
export default {
    id: "snazzy",
    name: "Snazzy",
    appliesTo: ["armor"],
    modifiers: {
        common: [{ stat: "magicFind", kind: "flat", value: 0.5 }],
        uncommon: [{ stat: "magicFind", kind: "flat", value: 0.75 }],
        rare: [{ stat: "magicFind", kind: "flat", value: 1 }],
        epic: [{ stat: "magicFind", kind: "flat", value: 1.5 }],
        legendary: [{ stat: "magicFind", kind: "flat", value: 2 }],
    },
} satisfies Reforge;
