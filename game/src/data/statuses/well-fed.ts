import type { Status } from "#geo/models";

export default {
    id: "well-fed",
    name: "Well Fed",
    duration: 4,
    maxStacks: 1,
    effects: [
        {
            id: "well-fed.regen",
            trigger: { event: "turnStart", as: "actor" },
            actions: [{ type: "heal", to: "self", amount: 8 }],
        },
    ],
} satisfies Status;
