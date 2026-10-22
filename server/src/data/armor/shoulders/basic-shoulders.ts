import type { Armor } from "#geo/models";

export default {
    id: "basic-shoulders",
    name: "Basic Shoulders",
    rarity: "common",
    icon: "shoulder-armor",
    description: "Padding, mostly. Stops a strap from digging in, and not much else.",
    slot: "shoulders",
    modifiers: [{ stat: "defense", kind: "flat", value: 1 }],
} satisfies Armor;
