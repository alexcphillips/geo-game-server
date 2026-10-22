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
                    amount: { flat: 3, perStack: true },
                    element: "fire",
                    ignoreDefense: true,
                },
            ],
        },
    ],
} satisfies Status;
