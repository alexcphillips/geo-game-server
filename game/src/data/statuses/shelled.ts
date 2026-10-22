import type { Status } from "#geo/models";

// The Giant River Crab's Shell Up. Multi-hit cards suffer most; armor pen cuts through.
export default {
    id: "shelled",
    name: "Shelled",
    duration: 3,
    maxStacks: 1,
    modifiers: [{ stat: "defense", kind: "flat", value: 2 }],
} satisfies Status;
