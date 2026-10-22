import type { Talisman } from "#geo/models";

export default {
    id: "storm-charm",
    name: "Storm Charm",
    rarity: "epic",
    icon: "lightning-helix",
    description: "30% chance to strike an attacker with lightning.",
    effectText: ["30% chance to strike an attacker with lightning for 10"],
    effects: [
        {
            id: "storm-charm.lightning",
            trigger: { event: "attacked", as: "target" },
            chance: 0.3,
            actions: [{ type: "damage", to: "other", amount: 10, element: "lightning", ignoreDefense: true }],
        },
    ],
} satisfies Talisman;
