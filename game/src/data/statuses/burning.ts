import type { Status } from "#geo/models";

export default {
    id: "burning",
    name: "Burning",
    duration: 3,
    maxStacks: 5,
    effects: [
        {
            id: "burning.tick",
            trigger: { event: "attackFinished", as: "actor" },
            actions: [
                {
                    type: "damage",
                    to: "self",
                    // 3% of the burning fighter's max health a stack, so it keeps up as health grows.
                    // TODO when Fireball is obtainable: a %-max-health burn shreds big bosses; give
                    // them a cap or a resistance.
                    amount: { stat: "maxHealth", multiplier: 0.03, perStack: true },
                    element: "fire",
                    ignoreDefense: true,
                },
            ],
        },
    ],
} satisfies Status;
