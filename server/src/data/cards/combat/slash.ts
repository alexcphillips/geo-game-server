import type { Card } from "#geo/models";

export default {
    id: "slash",
    name: "Slash",
    rarity: "common",
    icon: "sword-slice",
    description: "One plain cut. Any blade will do.",
    stats: [{ label: "Damage", value: "100% of Attack" }],
    skill: "combat",
    maxCharges: 100,
    targets: "enemy",
    requiresWeapon: ["melee"],
    actions: [{ type: "attack", to: "other", amount: { stat: "attack" }, delivery: "melee" }],
} satisfies Card;
