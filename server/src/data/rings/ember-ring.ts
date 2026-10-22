import type { Ring } from "#geo/models";

export default {
    id: "ember-ring",
    name: "Ember Ring",
    rarity: "rare",
    icon: "ring",
    description: "A thin band that never quite cools.",
    stats: [{ label: "Magic Power", value: "+4" }],
    effectText: ["5% chance to not spend a card charge"],
} satisfies Ring;
