import type { Talisman } from "#geo/models";

export default {
    id: "eye-of-the-watcher",
    name: "Eye of the Watcher",
    rarity: "epic",
    icon: "eye-of-horus",
    description: "It sees the weak point before you do.",
    modifiers: [{ stat: "critChance", kind: "flat", value: 0.05 }],
} satisfies Talisman;
