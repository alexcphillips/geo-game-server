import type { Card } from "#geo/models";

export default {
    id: "fish.gaff",
    name: "Gaff",
    rarity: "common",
    icon: "meat-hook",
    description: "A hook on a stick. Effective, not pretty.",
    stats: [
        { label: "Role", value: "Finisher" },
        { label: "Does", value: "Land it now if Distance ≤ 2 (≤ 4 when Exhausted). −2 Finesse." },
    ],
    skill: "fishing",
    maxCharges: 15,
    finesse: "lowers",
    targets: "self",
} satisfies Card;
