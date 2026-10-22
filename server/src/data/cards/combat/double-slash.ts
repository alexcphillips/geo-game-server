import type { Card } from "#geo/models";

export default {
    id: "double-slash",
    name: "Double Slash",
    rarity: "common",
    icon: "plain-dagger",
    description: "In and out twice before they've noticed the first.",
    stats: [{ label: "Damage", value: "70% of Attack, twice" }],
    skill: "combat",
    maxCharges: 40,
    targets: "enemy",
    requiresWeapon: ["dagger"],
    actions: [
        {
            type: "attack",
            to: "other",
            amount: { stat: "attack", multiplier: 0.7 },
            hits: 2,
            delivery: "melee",
        },
    ],
} satisfies Card;
