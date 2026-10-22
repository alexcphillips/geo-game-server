import type { Card } from "#geo/models";

export default {
    id: "farm.swat",
    name: "Swat",
    rarity: "common",
    icon: "bug-net",
    description: "The oldest pest control there is.",
    stats: [
        { label: "Role", value: "Pest control" },
        { label: "Does", value: "Hits every pest on a tile once. Each one cleared rolls its drops." },
    ],
    skill: "farming",
    maxCharges: 60,
    targets: "self",
} satisfies Card;
