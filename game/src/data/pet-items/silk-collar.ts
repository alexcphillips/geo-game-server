import type { PetItem } from "#geo/models";

// PLACEHOLDER: a first held item, so the slot can be tried out.
export default {
    id: "silk-collar",
    name: "Silk Collar",
    rarity: "uncommon",
    icon: "spider-web",
    description: "Soft, strong, and slightly sticky. A pet wearing it learns faster in a fight.",
    xpBoost: { multiplier: 1.2, skill: "combat" },
    modifiers: [{ stat: "defense", kind: "flat", value: 2 }],
} satisfies PetItem;
