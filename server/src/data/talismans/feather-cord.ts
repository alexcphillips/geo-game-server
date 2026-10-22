import type { Talisman } from "#geo/models";

export default {
    id: "feather-cord",
    name: "Feather Cord",
    rarity: "uncommon",
    icon: "feather-necklace",
    description: "Lighter than it has any right to be.",
    modifiers: [{ stat: "speed", kind: "flat", value: 1 }],
} satisfies Talisman;
