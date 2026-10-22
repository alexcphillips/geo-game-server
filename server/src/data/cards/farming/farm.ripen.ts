import type { Card } from "#geo/models";

export default {
    id: "farm.ripen",
    name: "Ripen",
    rarity: "uncommon",
    icon: "sun",
    description: "Coax it along, a little faster than it wants to go.",
    stats: [
        { label: "Role", value: "Grow" },
        { label: "Does", value: "A growing crop moves one stage now." },
    ],
    skill: "farming",
    maxCharges: 25,
    targets: "self",
} satisfies Card;
