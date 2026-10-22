import type { Status } from "#geo/models";

// Lasts the fight: stacks only build. Envenom's Venom Coat adds one a hit.
export default {
    id: "poisoned",
    name: "Poisoned",
    maxStacks: 5,
    effects: [
        {
            id: "poisoned.tick",
            trigger: { event: "turnStart", as: "actor" },
            actions: [
                {
                    type: "damage",
                    to: "self",
                    amount: { flat: 1, perStack: true },
                    element: "poison",
                    ignoreDefense: true,
                },
            ],
        },
    ],
} satisfies Status;
