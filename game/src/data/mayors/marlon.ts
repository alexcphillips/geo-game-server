import type { Mayor } from "#geo/models";

export default {
    id: "marlon",
    name: "Marlon",
    perks: [
        {
            id: "bait-lover",
            name: "Bait Lover",
            description: "10% chance not to spend bait when fishing.",
            icon: "fishing-hook",
            modifiers: [{ stat: "baitSaveChance", kind: "flat", value: 0.1 }],
        },
        {
            id: "eel-affinity",
            name: "Eel Affinity",
            description: "+10% bonus Eel chance.",
            icon: "salmon",
            modifiers: [{ stat: "eelChance", kind: "flat", value: 0.1 }],
        },
        {
            id: "fishing-master",
            name: "Fishing Master",
            description: "10% increased Sea Creature Chance.",
            icon: "anchor",
            modifiers: [{ stat: "seaCreatureChance", kind: "percent", value: 0.1 }],
        },
    ],
} satisfies Mayor;
