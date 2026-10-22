import type { Card } from "#geo/models";

export default {
    id: "farm.controlled-leak",
    name: "Controlled Leak",
    rarity: "rare",
    icon: "barrel-leak",
    description: "Just a little. On purpose. Probably.",
    stats: [
        { label: "Role", value: "Atomic" },
        { label: "Does", value: "Waste on the 4 tiles beside the aimed one, killing what grows there: mutation odds up around it." },
    ],
    skill: "farming",
    maxCharges: 15,
    targets: "self",
} satisfies Card;
