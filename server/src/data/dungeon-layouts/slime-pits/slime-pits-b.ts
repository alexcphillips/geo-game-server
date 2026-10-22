import type { DungeonLayout } from "#geo/models";

// A long Brood Pool (2×1) and a Drip Hall (2×1). The boss is north, west or
// south-west; the other two slots roll from the pool.
export default {
    id: "slime-pits-b",
    dungeon: "slime-pits",
    map: `
          1
          |
        2-p-p-s
          |
        3-h-h
            |
            E
    `,
    rooms: {
        E: "entrance",
        p: { kind: "encounter", name: "Brood Pool" },
        h: { kind: "event", name: "Drip Hall" },
        s: "star",
    },
    place: [{ room: "den", at: [1, 2, 3] }],
} satisfies DungeonLayout;
