import type { Talisman } from "#geo/models";

export default {
    id: "heart-locket",
    name: "Heart Locket",
    rarity: "uncommon",
    icon: "heart-necklace",
    description: "Empty. Whoever was inside has moved on.",
    modifiers: [{ stat: "maxHealth", kind: "flat", value: 5 }],
} satisfies Talisman;
