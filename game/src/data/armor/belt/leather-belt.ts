import type { Armor } from "#geo/models";

export default {
    id: "leather-belt",
    name: "Leather Belt",
    rarity: "common",
    icon: "belt",
    description: "Plain, sturdy, and punched with one more hole than it came with.",
    slot: "belt",
    modifiers: [{ stat: "maxHealth", kind: "flat", value: 10 }],
} satisfies Armor;
