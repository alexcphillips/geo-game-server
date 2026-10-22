import type { Talisman } from "#geo/models";

export default {
    id: "digested-shrimp",
    name: "Digested Shrimp",
    rarity: "uncommon",
    icon: "diamond-ring",
    description: "Placeholder",
    modifiers: [{ stat: "seaCreatureChance", kind: "flat", value: 0.01 }],
    sellValue: 30,
} satisfies Talisman;
