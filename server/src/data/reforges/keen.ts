import type { Reforge } from "#geo/models";

// Crit chance. 0.03 = +3%.
export default {
    id: "keen",
    name: "Keen",
    appliesTo: ["weapon"],
    modifiers: {
        common: [{ stat: "critChance", kind: "flat", value: 0.03 }],
        uncommon: [{ stat: "critChance", kind: "flat", value: 0.04 }],
        rare: [{ stat: "critChance", kind: "flat", value: 0.06 }],
        epic: [{ stat: "critChance", kind: "flat", value: 0.08 }],
        legendary: [{ stat: "critChance", kind: "flat", value: 0.1 }],
    },
} satisfies Reforge;
