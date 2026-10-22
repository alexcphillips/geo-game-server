import type { Card } from "#geo/models";

// Crafted from Spider Fangs. One charge a fight: the coat lasts until it ends.
export default {
    id: "envenom",
    name: "Envenom",
    rarity: "rare",
    icon: "poison-bottle",
    description:
        "Spider venom, worked into the edge. Every cut leaves some behind.",
    stats: [
        { label: "Venom Coat", value: "Rest of the fight" },
        { label: "Each hit", value: "+1 Poisoned (max 5)" },
        { label: "Poisoned", value: "1 per stack each turn, ignores Defense" },
    ],
    skill: "combat",
    maxCharges: 10,
    targets: "self",
    requiresWeapon: ["melee"],
    // Greyed out while coated; playable again if something strips the coat.
    playableIf: [{ type: "lacksStatus", who: "self", status: "venom-coat" }],
    actions: [{ type: "applyStatus", to: "self", status: "venom-coat" }],
} satisfies Card;
