import type { Card } from "#geo/models";

export default {
    id: "farm.hold",
    name: "Hold",
    rarity: "uncommon",
    icon: "hourglass",
    description: "Wrap it up and keep it as it is.",
    stats: [
        { label: "Role", value: "Harvest" },
        { label: "Does", value: "A ripe crop neither rots nor improves on the next cycle." },
    ],
    skill: "farming",
    maxCharges: 30,
    targets: "self",
} satisfies Card;
