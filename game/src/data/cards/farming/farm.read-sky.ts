import type { Card } from "#geo/models";

export default {
    id: "farm.read-sky",
    name: "Read the Sky",
    rarity: "common",
    icon: "sun-cloud",
    description: "Red sky at night.",
    stats: [
        { label: "Role", value: "Info" },
        { label: "Does", value: "The forecast shows the next 3 cycles, until the next one comes." },
    ],
    skill: "farming",
    maxCharges: 40,
    targets: "self",
} satisfies Card;
