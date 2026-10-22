import type { Armor } from "#geo/models";

export default {
    id: "slime-grip-wraps",
    name: "Slime Grip Wraps",
    rarity: "uncommon",
    icon: "gauntlet",
    description: "Placeholder",
    slot: "hands",
    modifiers: [{ stat: "attack", kind: "flat", value: 2 }],
    sellValue: 25,
} satisfies Armor;
