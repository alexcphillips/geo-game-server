import type { Card } from "#geo/models";

export default {
    id: "farm.hand-pollinate",
    name: "Hand Pollinate",
    rarity: "uncommon",
    icon: "pollen-dust",
    description: "A feather, a steady hand, and a guess.",
    stats: [
        { label: "Role", value: "Breed" },
        { label: "Does", value: "Aim at an empty tile: its mutation odds double on the next cycle. Ripe crops around it lose their waiting bonus." },
    ],
    skill: "farming",
    maxCharges: 30,
    targets: "self",
} satisfies Card;
