import type { Status } from "#geo/models";

export default {
    id: "frozen",
    name: "Frozen",
    duration: 3,
    maxStacks: 1,
    effects: [
        {
            id: "frozen.thaw",
            trigger: { event: "turnStart", as: "actor" },
            chance: 0.5,
            actions: [{ type: "removeStatus", from: "self", status: "frozen" }],
        },
        {
            id: "frozen.skip",
            trigger: { event: "beforeAction", as: "actor" },
            actions: [{ type: "cancelAction" }],
        },
    ],
} satisfies Status;
