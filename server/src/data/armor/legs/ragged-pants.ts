import type { Armor } from "#geo/models";

export default {
    id: "ragged-pants",
    name: "Ragged Pants",
    rarity: "common",
    icon: "greaves",
    description: "Placeholder",
    slot: "legs",
    modifiers: [{ stat: "defense", kind: "flat", value: 1 }],
} satisfies Armor;
