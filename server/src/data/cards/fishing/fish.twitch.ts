import type { Card } from "#geo/models";

export default {
    id: "fish.twitch",
    name: "Twitch",
    rarity: "uncommon",
    icon: "fishing-lure",
    description: "A flick of the lure gives it pause.",
    stats: [
        { label: "Role", value: "Trick" },
        { label: "Does", value: "Change the fish's move to Rest. +1 Finesse." },
    ],
    skill: "fishing",
    maxCharges: 10,
    finesse: "raises",
    targets: "self",
} satisfies Card;
