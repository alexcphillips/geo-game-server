import type { Card } from "#geo/models";

export default {
    id: "farm.careful-pick",
    name: "Careful Pick",
    rarity: "common",
    icon: "fruit-bowl",
    description: "Slow hands, nothing bruised.",
    stats: [
        { label: "Role", value: "Harvest" },
        { label: "Does", value: "Harvest one ripe crop with +1 yield." },
    ],
    skill: "farming",
    maxCharges: 60,
    targets: "self",
} satisfies Card;
