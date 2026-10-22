import type { Card } from "#geo/models";

export default {
    id: "farm.tear-the-veil",
    name: "Tear the Veil",
    rarity: "epic",
    icon: "portal",
    description: "Some doors are better left shut. This isn't one of them.",
    stats: [
        { label: "Role", value: "Mystic" },
        { label: "Does", value: "Aim at a Portal: elite pests come through it on the next cycle." },
    ],
    skill: "farming",
    sellValue: 100,
    maxCharges: 10,
    targets: "self",
} satisfies Card;
