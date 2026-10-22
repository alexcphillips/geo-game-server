import type { Armor } from "#geo/models";

export default {
    id: "crown-of-ash",
    name: "Crown of Ash",
    rarity: "epic",
    icon: "crown",
    description: "Still warm. Whoever wore it last spent a long time beside a fire.",
    effectText: ["Firemaking ash chance +10%"],
    slot: "head",
    modifiers: [{ stat: "defense", kind: "flat", value: 3 }],
} satisfies Armor;
