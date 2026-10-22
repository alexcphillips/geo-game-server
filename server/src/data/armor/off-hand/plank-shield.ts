import type { Armor } from "#geo/models";

export default {
    id: "plank-shield",
    name: "Plank Shield",
    rarity: "common",
    icon: "round-shield",
    description: "Placeholder",
    slot: "offHand",
    offHand: { type: "shield" },
    modifiers: [{ stat: "defense", kind: "flat", value: 1 }],
} satisfies Armor;
