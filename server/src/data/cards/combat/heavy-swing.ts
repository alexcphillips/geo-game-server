import type { Card } from "#geo/models";

export default {
    id: "heavy-swing",
    name: "Heavy Swing",
    rarity: "common",
    icon: "crossed-swords",
    description: "A slow, committed blow. Hits hard if it lands.",
    stats: [
        { label: "Damage", value: "200% of Attack" },
    ],
    skill: "combat",
    requiresWeapon: ["greatsword"],
    maxCharges: 20,
    targets: "enemy",
    actions: [
        {
            type: "attack",
            to: "other",
            amount: { stat: "attack", multiplier: 2 },
            delivery: "melee",
        },
    ],
} satisfies Card;
