import type { Card } from "#geo/models";

export default {
    id: "precise-strike",
    name: "Precise Strike",
    rarity: "epic",
    icon: "broadsword",
    description: "Wait for the opening, then take it.",
    stats: [{ label: "Damage", value: "250% of Attack" }],
    skill: "combat",
    maxCharges: 30,
    targets: "enemy",
    actions: [
        { type: "attack", to: "other", amount: { stat: "attack", multiplier: 2.5 }, delivery: "melee" },
    ],
} satisfies Card;
