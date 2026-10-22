import type { Card } from "#geo/models";

export default {
    id: "fish.patient",
    name: "Patient Hands",
    rarity: "rare",
    icon: "stopwatch",
    description: "Breathe. Wait. Then wait a little more.",
    stats: [
        { label: "Role", value: "Finesse" },
        { label: "Does", value: "Focus for 3 turns: each turn ending in the zone gives +1 more Finesse." },
    ],
    skill: "fishing",
    maxCharges: 10,
    finesse: "raises",
    targets: "self",
} satisfies Card;
