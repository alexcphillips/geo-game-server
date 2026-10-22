import type { Card } from "#geo/models";

export default {
    id: "fish.read",
    name: "Read the Water",
    rarity: "uncommon",
    icon: "eye-target",
    description: "Watch the swirls, not the line.",
    stats: [
        { label: "Role", value: "Info" },
        { label: "Does", value: "See the fish's next 3 moves for 3 turns. +1 Finesse." },
    ],
    skill: "fishing",
    maxCharges: 15,
    finesse: "raises",
    targets: "self",
} satisfies Card;
