import type { Armor } from "#geo/models";

export default {
    id: "basic-shoes",
    name: "Basic Shoes",
    rarity: "common",
    icon: "walking-boot",
    description: "Two soles, two laces, and that's the whole sales pitch.",
    slot: "feet",
    modifiers: [{ stat: "defense", kind: "flat", value: 1 }],
} satisfies Armor;
