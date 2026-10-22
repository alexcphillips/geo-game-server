# Enemies

What you fight in a combat Run: stats, moves, innate rules, and what it
drops. To make an enemy spawn on the map, give it `habitats` (near mines,
water, POIs…), or add it to
[`config/spawns.ts`](../config/README.md#spawnsts) `enemies` to spawn anywhere.
It only spawns once the app has its `sprite`: add `<sprite>.png` to geo-game's
`src/features/spawns/assets/` and run `npm run sprites` there.

## Fields

Model: `Enemy` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id` | text | yes | Matches the file name. |
| `name` | text | yes | Shown in the app. |
| `sprite` | text | yes | The app's sprite name. |
| `tier` | whole number ≥ 1 | yes | How far into the game it belongs. It spawns on the map only once the player's combat level opens its tier ([`tierUnlockLevels`](../config/README.md#spawnsts)), and more rarely once they're past it. |
| `stats` | `{ stat: number }` | yes | e.g. `maxHealth`, `attack`, `defense`, `speed`, `critChance`. Missing stats are 0. See [stats](../EFFECTS.md#stats). |
| `barrier` | whole number ≥ 1 | no | A barrier it spawns with: soaks that much damage (after guard, before health) until broken. Moves can cast more with the [`barrier` action](../EFFECTS.md#actions). |
| `moves` | list of moves (at least 1) | yes | Each turn it picks one by weight. |
| `moves[].id`, `.name` | text | yes | `name` is shown when it's used. |
| `moves[].weight` | number > 0 | yes | Against its other moves: 3 vs 1 = 75% / 25%. |
| `moves[].actions` | list of [actions](../EFFECTS.md#actions) | yes | What the move does. `other` is the player. |
| `effects` | list of [effects](../EFFECTS.md#effects-when-x-if-y-maybe-do-z) | no | Innate rules, e.g. poisons on hit, or enrages below half health. |
| `loot` | list of `{ itemId, chance, quantity: { min, max } }` | no | Each rolled on its own on a win. `chance` 0–1. |
| `coins` | `{ min, max }` | no | Coins on a kill, inclusive. |
| `xp` | whole number ≥ 0 | yes | Combat XP for the kill. |
| `chests` | see below | no | A chance of a chest selection in place of `loot`. |
| `leavesAfterWinning` | `true` / `false` | no | Gone from the map once it has beaten you. |
| `habitats` | list of `{ near, weight, waters? }` | no | Where it spawns: see below. |

## Habitats

Each new spawn near a kind of place may be one of the enemies living there.
`near` is the kind of place: `water`, `mining`, `foraging`, `farming` (farmland
and farming hubs) or `landmark` (POIs). `weight` is against the other enemies
living there: 30 vs 10 = 75% / 25%. A water habitat's `waters` limits it to
those kinds of water (`pond`, `lake`, `river`, `dock`, `ocean`).

```
habitats: [{ near: "mining", weight: 20 }, { near: "landmark", weight: 5 }],
```

How hard each kind of place pulls, and from how far, is in
[`config/spawns.ts`](../config/README.md#spawnsts) `habitats`.

## Chests

On a win, `chests.chance` (0–1) of the time the player gets a selection of
chests and opens one, in place of `loot`. Coins and XP still come.

- `offers`: the chests that may appear, each with its own `chance` (0–1).
  At least one needs `1`, so the selection is never empty.
  - `tier`: `plain`, `gold`, `ruby`, `void`. Names and opening costs are in
    `config/chest-tiers.ts`.
  - `pools`: each pool makes `rolls` (`{ min, max }`) weighted picks from its
    `entries`, repeats allowed. At least one pool needs `min` ≥ 1.
  - `entries`: `{ itemId, weight, quantity: { min, max } }`.

The dev-only `test-chest-boss.ts` is a full example.

## Example

```ts
import type { Enemy } from "#geo/models";

export default {
    id: "bog-toad",
    name: "Bog Toad",
    sprite: "toad",
    tier: 2,
    stats: { maxHealth: 60, attack: 9, defense: 2, speed: 6 },
    moves: [
        {
            id: "slam",
            name: "Slam",
            weight: 3,
            actions: [{ type: "attack", to: "other", amount: { stat: "attack" }, delivery: "melee" }],
        },
        {
            id: "tongue-lash",
            name: "Tongue Lash",
            weight: 1,
            actions: [
                {
                    type: "attack",
                    to: "other",
                    amount: { stat: "attack", multiplier: 0.5 },
                    delivery: "projectile",
                },
                { type: "heal", to: "self", amount: 10 },
            ],
        },
    ],
    effects: [
        {
            id: "bog-toad.slimy",
            trigger: { event: "attacked", as: "target" },
            chance: 0.25,
            actions: [{ type: "guard", to: "self", amount: 5 }],
        },
    ],
    loot: [{ itemId: "bones", chance: 1, quantity: { min: 1, max: 1 } }, { itemId: "eel-gel", chance: 0.3, quantity: { min: 1, max: 2 } }],
    coins: { min: 2, max: 6 },
    xp: 55,
} satisfies Enemy;
```
