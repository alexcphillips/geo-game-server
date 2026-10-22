import type { Card } from "#geo/models";

export default {
    id: "fish.tire",
    name: "Tire It Out",
    rarity: "uncommon",
    icon: "tired-eye",
    description: "Make it pay for every metre.",
    stats: [
        { label: "Role", value: "Setup" },
        {
            label: "Does",
            value: "If it Runs or Dives: −Stamina (more with Fishing Power), it's Tired (your next progress ×2), +2 Finesse. Otherwise +1 Tension.",
        },
    ],
    skill: "fishing",
    maxCharges: 15,
    finesse: "raises",
    targets: "self",
} satisfies Card;
