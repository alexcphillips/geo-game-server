import type { Card } from "#geo/models";

export default {
    id: "farm.chain-reaction",
    name: "Chain Reaction",
    rarity: "epic",
    icon: "nuclear",
    description: "Set it all off at once and stand well back.",
    stats: [
        { label: "Role", value: "Atomic" },
        { label: "Does", value: "Every waste tile: 30% it becomes a random mutation, else a Glow Beetle crawls out." },
    ],
    skill: "farming",
    maxCharges: 3,
    targets: "self",
} satisfies Card;
