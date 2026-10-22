# Dungeon layouts

Hand-drawn dungeon maps. Each run picks one of a dungeon's layouts at
random, fills its slots, and may flip it left to right. Files go in a
subfolder named after their dungeon: `dungeon-layouts/slime-pits/slime-pits-a.ts`.

Try layouts out in the [Dungeon Layout Playground](https://claude.ai/artifact/3wjeqGEz5MXAum7rRnrBwM)
before writing them here: it draws them, rolls them and walks them with fog.

## The map

Rooms sit on every other column and every other line; the gaps between
them hold doors.

```
1-a-a   2      a letter  = a room; the same letter touching itself is one room (2×1, 3×1, 2×2, L…)
|   |   |      a digit   = a slot, filled each run (by `place`, then the dungeon's pool)
3   c-c-c-k    - and |   = a door between two cells
|   |          a space   = a wall
s-s-E
```

- The entrance goes on the **bottom line**. Mirroring is left to right only,
  so it stays there.
- The boss room is always **1×1**.
- Every star room, gold room, puzzle and the boss must be reachable without
  a key.
- Rooms can't overlap: every room and slot is drawn, and `place` only picks
  among drawn slots.

## Rooms

Each letter, place rule and pool entry names a room in one of three ways:

- a kind: `"encounter"`;
- one of the dungeon's named `rooms`: `"sluice-gate"`;
- a room written out: `{ kind: "loot", name: "Sluice Cache", style: "sluice" }`.

| Kind | What it is | Blocks the way until done? |
| --- | --- | --- |
| `entrance` | Where the party starts. One per layout. | no |
| `encounter` | A fight from `encounterEnemies`. | yes |
| `star` | A harder fight from `starEnemies`. Clearing every star opens the boss. | yes |
| `miniboss` | A gold room: a harder fight from `minibossEnemies`, worth score. | yes |
| `puzzle` | One player, one try. | yes |
| `loot` | Each player collects their own. | no |
| `event` | Each player gets their own. | no |
| `boss` | The dungeon's `boss`. One per layout, 1×1. | — |
| `empty` | Nothing. | no |

A room's optional fields:

| Field | What it does |
| --- | --- |
| `name` | Shown on the map. |
| `style` | A [room style](../room-styles/README.md); default the layout's, then the dungeon's. |
| `lock` | The item id of the key that opens it. Every room you can only reach through it becomes a **private wing** for whoever opens it. Wings can't hold a puzzle, star, gold room or the boss, and their rooms don't count toward score. |

## Fields

Model: `DungeonLayout` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id` | text | yes | Must match the file name. |
| `dungeon` | dungeon id | yes | Its dungeon; also the subfolder it goes in. |
| `map` | text | yes | The drawing. Indentation is ignored. |
| `rooms` | `{ letter: room }` | yes | What each letter on the map is. |
| `place` | list of `{ room, at, chance? }` | no | Each run, puts `room` into one free slot from `at`, in list order. Without `chance` it always appears; when a chance misses, the slot goes to the pool. |
| `roomStyle` | room-style id | no | Outline style for its rooms; overrides the dungeon's. |
| `mirror` | yes/no | no (default yes) | Whether a run may flip it left to right. |

The server tries every combination of `place` choices when it starts, so a
layout that could ever roll wrong (two bosses, a star behind a lock, the
wrong number of star rooms) stops the start with the reason.

## Example

```ts
import type { DungeonLayout } from "#geo/models";

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
```
