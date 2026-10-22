import type { Card } from "#geo/models";

export default {
    id: "farm.bait-ring",
    name: "Bait Ring",
    rarity: "common",
    icon: "honeypot",
    description: "Something sweet in the middle draws them in.",
    stats: [
        { label: "Role", value: "Pest control" },
        { label: "Does", value: "Pulls every pest in the 8 tiles around onto the middle tile, and its crop." },
    ],
    skill: "farming",
    maxCharges: 40,
    targets: "self",
} satisfies Card;
