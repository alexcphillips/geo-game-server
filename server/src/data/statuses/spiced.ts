import type { Status } from "#geo/models";

export default {
    id: "spiced",
    name: "Spiced",
    duration: 4,
    maxStacks: 1,
    modifiers: [{ stat: "attack", kind: "percent", value: 0.2 }],
} satisfies Status;
