import type { Card } from "#geo/models";

export default {
    id: "fireball",
    name: "Fireball",
    rarity: "rare",
    icon: "magic-swirl",
    description: "Sets the target alight. Free against a target already burning.",
    stats: [{ label: "Damage", value: "80% of Attack" }, { label: "Applies", value: "Burning" }],
    skill: "combat",
    maxCharges: 20,
    targets: "enemy",
    tags: ["fire"],
    actions: [
        {
            type: "attack",
            to: "other",
            amount: { stat: "attack", multiplier: 0.8 },
            element: "fire",
            delivery: "projectile",
        },
        { type: "applyStatus", to: "other", status: "burning" },
    ],
    effects: [
        {
            id: "fireball.free-if-burning",
            trigger: { event: "cardPlayed", as: "actor" },
            conditions: [{ type: "hasStatus", who: "target", status: "burning" }],
            actions: [{ type: "freeCharge" }],
        },
    ],
} satisfies Card;
