import type { Card } from "#geo/models";

export default {
    id: "quick-slash",
    name: "Quick Slash",
    rarity: "common",
    icon: "pointy-sword",
    description: "A fast cut. Reliable, if unremarkable.",
    stats: [{ label: "Damage", value: "100% of Attack" }],
    skill: "combat",
    maxCharges: 30,
    targets: "enemy",
    actions: [{ type: "attack", to: "other", amount: { stat: "attack" }, delivery: "melee" }],
} satisfies Card;
