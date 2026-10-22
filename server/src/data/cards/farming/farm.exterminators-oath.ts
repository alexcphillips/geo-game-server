import type { Card } from "#geo/models";

export default {
    id: "farm.exterminators-oath",
    name: "Exterminator's Oath",
    rarity: "epic",
    icon: "bug-net",
    description: "You swear it on the shell of the first one you ever caught.",
    stats: [
        { label: "Role", value: "Pest control" },
        { label: "Does", value: "The next 3 pests cleared roll their drops twice." },
    ],
    skill: "farming",
    maxCharges: 5,
    targets: "self",
} satisfies Card;
