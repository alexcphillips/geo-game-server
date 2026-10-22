import type { Card } from "#geo/models";

export default {
    id: "farm.snap-trap",
    name: "Snap Trap",
    rarity: "uncommon",
    icon: "wolf-trap",
    description: "Set it where they're going, not where they are.",
    stats: [
        { label: "Role", value: "Pest control" },
        { label: "Does", value: "A pest moving onto the tile on the next cycle is caught. Wasted if none does." },
    ],
    skill: "farming",
    maxCharges: 40,
    targets: "self",
} satisfies Card;
