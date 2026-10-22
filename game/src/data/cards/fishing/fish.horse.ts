import type { Card } from "#geo/models";

export default {
    id: "fish.horse",
    name: "Horse It In",
    rarity: "common",
    icon: "muscle-up",
    description: "No finesse, all arm.",
    stats: [
        { label: "Role", value: "Power" },
        { label: "Does", value: "−4 Distance (more with Fishing Power), +4 Tension. −1 Finesse." },
    ],
    skill: "fishing",
    maxCharges: 20,
    finesse: "lowers",
    targets: "self",
} satisfies Card;
