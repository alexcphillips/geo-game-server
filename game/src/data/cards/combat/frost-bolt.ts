import type { Card } from "#geo/models";

export default {
    id: "frost-bolt",
    name: "Frost Bolt",
    rarity: "rare",
    icon: "frozen-orb",
    description: "Freezes the target solid. It may thaw at the start of its turn.",
    stats: [{ label: "Damage", value: "50% of Attack" }, { label: "Applies", value: "Frozen" }],
    skill: "combat",
    maxCharges: 15,
    targets: "enemy",
    tags: ["ice"],
    actions: [
        {
            type: "attack",
            to: "other",
            amount: { stat: "attack", multiplier: 0.5 },
            element: "ice",
            delivery: "projectile",
        },
        { type: "applyStatus", to: "other", status: "frozen" },
    ],
} satisfies Card;
