import type { Card } from "#geo/models";

// PLACEHOLDER: foraging has no Runs yet, so this does nothing.
export default {
    id: "keen-eye",
    name: "Keen Eye",
    rarity: "uncommon",
    icon: "pine-tree",
    description: "Spot what others walk past.",
    stats: [{ label: "Finds", value: "+1" }],
    skill: "foraging",
    maxCharges: 100,
    targets: "self",
} satisfies Card;
