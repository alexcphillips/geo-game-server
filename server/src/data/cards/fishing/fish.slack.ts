import type { Card } from "#geo/models";

export default {
    id: "fish.slack",
    name: "Give Slack",
    rarity: "common",
    icon: "waves",
    description: "Let it run, and save your line.",
    stats: [
        { label: "Role", value: "Relief" },
        { label: "Does", value: "−3 Tension, +1 Distance, +1 Momentum (max 3)." },
    ],
    skill: "fishing",
    maxCharges: 40,
    targets: "self",
} satisfies Card;
