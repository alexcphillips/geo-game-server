# Dungeons

Raid-style boss fights. Any POI opens the dungeon menu: one worldwide list of
lobbies. A player at a POI creates a lobby for a dungeon, others join, and when
the host starts it everyone in it goes in at once. There's no countdown.

A dungeon with layouts in `dungeon-layouts/` is a map: each player walks
their own rolled copy for now, room by room, to the boss, and its chests
come from the score. Room fights drop their enemies' usual loot, coins and
XP, so a dungeon-only enemy can drop gear; there's more in loot rooms and
the end chests. A dungeon without layouts is a lone boss fight with the
boss's usual loot, coins and XP. Shared party maps, and scaling to the
party's size, come later. A death in a dungeon never costs coins.

A dungeon is only offered once the app has its boss's sprite, as with spawns.

## Fields

Model: `Dungeon` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id`, `name` | text | yes | |
| `description` | text | yes | One or two sentences for the lobby menu. |
| `boss` | enemy id | yes | The enemy fought: its stats, moves, loot and sprite. |
| `bossModifiers` | list of [modifiers](../EFFECTS.md#modifiers) | no | Makes the boss bigger than it is on the map. `percent` 2 = triple. |
| `requiredLevel` | 0–50 | yes | The combat level needed to make or join a lobby for it. 0 = none. A host can ask more of their lobby, up to their own level. |
| `maxPlayers` | 1–8 | yes | Lobby size, host included. |
| `stars` | whole number ≥ 0 | once it has layouts | Star rooms in **every** layout. Clearing them all opens the boss room. |
| `minibosses` | whole number ≥ 0 | no (default 0) | Gold rooms (kind `miniboss`) in every layout: a harder fight worth score. |
| `encounterEnemies` | list of enemy ids | once it has layouts | What an encounter room picks its enemy from. |
| `starEnemies` | list of enemy ids | once it has layouts | What a star room picks from. |
| `minibossEnemies` | list of enemy ids | when `minibosses` > 0 | What a gold room picks from. |
| `chestScores` | `{ gold?, ruby?, void? }`, 0–100 | no (default 40 / 70 / 90) | The lowest score that offers each chest tier at the end. Plain is always offered; Void also needs no failed puzzle. |
| `roomLoot` | list of [chest pools](../enemies/README.md) | once it has layouts | What a loot room gives each player who collects it, straight into their inventory. |
| `chests` | `{ plain, gold?, ruby?, void? }`, each a list of chest pools | `plain` once it has layouts | What each end chest holds. A tier left out is never offered. |
| `penalties` | `{ failedPuzzle?, death? }` | no (default 20 / 15) | Points off the score for each failed puzzle and each death. |
| `roomStyle` | room-style id | no | Outline style for rooms that don't pick one ([room styles](../room-styles/README.md)). |
| `rooms` | `{ id: room }` | no | Named rooms its layouts can use by id, e.g. a locked gate. See [rooms](../dungeon-layouts/README.md#rooms). |
| `pool` | list of `{ room, weight?, max? }` | no | What leftover slots roll from: `weight` default 1, `max` per run. No entrance, star, gold room or boss. |

**Score** (0–100) is worked out from the rolled map, so no layout needs
tuning: each optional room (encounter, loot or event outside a key wing) is
worth 1 point, each puzzle 2 and each gold room 3. The score is the share of
those points earned, minus the penalties. The server counts it from its own
record of the run; the app never reports it.

A dungeon with no layouts in `dungeon-layouts/` is a lone boss fight, as
before. Its map, rooms and rules are in the
[dungeon layouts guide](../dungeon-layouts/README.md).

## Example

```ts
import type { Dungeon } from "#geo/models";

export default {
    id: "slime-pits",
    name: "Slime Pits",
    description: "Something huge has settled at the bottom of the pits, and the slimes keep coming from it.",
    boss: "mother-slime",
    requiredLevel: 0,
    maxPlayers: 4,
    stars: 1,
    encounterEnemies: ["green-slime"],
    starEnemies: ["green-slime"],
    roomStyle: "slime-pool",
    rooms: {
        den: { kind: "boss", name: "Mother's Den", style: "boss-den" },
        "sluice-gate": { kind: "encounter", name: "Sluice Gate", lock: "sluice-key" },
    },
    pool: [
        { room: "encounter", weight: 3 },
        { room: "loot" },
        { room: "event", max: 1 },
    ],
} satisfies Dungeon;
```

How long a host can be away before their unstarted lobby closes is
`GEO_DUNGEON_HOST_AWAY_SECONDS` in `shared/src/dungeon.contract.ts`.
