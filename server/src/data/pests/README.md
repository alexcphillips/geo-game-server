# Pests

Pests are pieces on the farm grid. Each comes for the crops it `likes`,
shows its next move before it happens, and acts on the farm's next turn.
The player answers with Swat (a plain action) or pest-control cards
(Smoke, Bait Ring, Snap Trap). A cleared pest rolls its `drops`.

When and how often pests spawn is in
[`config/farming.ts`](../config/README.md#farmingts) (`pests`).

## Fields

Model: `Pest` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id` | text | yes | Matches the file name. |
| `name`, `icon`, `description` | text | yes | Shown in the app. |
| `likes` | crop ids | yes | It only spawns while one of these grows, next to it, and goes for them first. May be empty for a Portal or waste pest. |
| `behaviour` | one of below | yes | How it acts each turn. |
| `weight` | number ≥ 0 | yes | How likely it is to be the pest that spawns, per liked crop growing. 0: never on its own, only from a Portal or nuclear waste. |
| `hp` | whole number ≥ 1 | no (1) | Hits to clear: Swat, Smoke and a Snap Trap hit once. Cages and frogs only take 1-hit pests. More than 1 is an elite pest. |
| `drops` | `{ itemId, chance, quantity }[]` | yes | Each rolled on its own when it's cleared; `chance` is 0–1. |
| `xp` | whole number ≥ 0 | yes | Farming XP when it's cleared. |
| `bounty` | whole number ≥ 0 | no (0) | Pesthunter points for turning it in from a Pest Cage (see `pesthunter` in [`config/farming.ts`](../config/README.md#farmingts)). Elites can't be caged, so leave it off them. |

## Behaviours

| `behaviour` | What it does |
| --- | --- |
| `{ kind: "eat", reach }` | Eats the crop on its tile, or moves onto one up to `reach` tiles away (diagonals count) and eats it. The crop is gone. |
| `{ kind: "sap" }` | The crop it's on doesn't grow. With no crop under it, it moves onto one next door. It never eats or breeds. |
| `{ kind: "breed", every }` | The crop it's on doesn't grow. Every `every` turns, a new one appears on a crop next door. |

With nothing to go for, a pest wanders one tile.
