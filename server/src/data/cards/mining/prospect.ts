import type { Card } from "#geo/models";

// PLACEHOLDER: mining has no Runs yet, so this does nothing.
export default {
    id: "prospect",
    name: "Prospect",
    rarity: "epic",
    icon: "ore",
    description: "Read the rock before you break it.",
    stats: [{ label: "Reveal", value: "2 veins" }],
    skill: "mining",
    maxCharges: 40,
    targets: "self",
} satisfies Card;
