import type { DungeonLayout } from "#geo/models";

// The boss is north-west or north-east. East of the middle room, the
// Sluice Gate opens a private wing for whoever has the key.
export default {
    id: "slime-pits-a",
    dungeon: "slime-pits",
    map: `
        1-a-2
          |
        s-c-k-w
          |   |
          E   x
    `,
    rooms: {
        E: "entrance",
        a: "encounter",
        c: "encounter",
        s: "star",
        k: "sluice-gate",
        w: { kind: "encounter", style: "sluice" },
        x: { kind: "loot", name: "Sluice Cache", style: "sluice" },
    },
    place: [{ room: "den", at: [1, 2] }],
} satisfies DungeonLayout;
