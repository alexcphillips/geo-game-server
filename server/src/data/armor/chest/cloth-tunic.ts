import type { Armor } from "#geo/models";

export default {
    id: "cloth-tunic",
    name: "Cloth Tunic",
    rarity: "common",
    icon: "breastplate",
    description: "Placeholder.",
    slot: "chest",
    modifiers: [{ stat: "defense", kind: "flat", value: 1 }],
} satisfies Armor;
