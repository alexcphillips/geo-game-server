import type { Status } from "#geo/models";

// The Giant Tarantula's Paralyzing Bite. Each of the bearer's next 2 turns may be lost, eating included.
export default {
    id: "paralyzed",
    name: "Paralyzed",
    duration: 2,
    maxStacks: 1,
    effects: [
        {
            id: "paralyzed.skip",
            trigger: { event: "beforeAction", as: "actor" },
            chance: 0.5,
            actions: [{ type: "cancelAction" }],
        },
    ],
} satisfies Status;
