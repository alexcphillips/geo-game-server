# Statuses

Burning, Frozen, Well Fed: anything that sits on a combatant for a while.
Cards, food, gear and enemies apply them with `applyStatus`. Conditions
check them with `hasStatus` / `lacksStatus`.

## Fields

Model: `Status` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id` | text | yes | Matches the file name. Other files use it. |
| `name` | text | yes | Shown in the app. |
| `duration` | whole number ≥ 1 | no | In the bearer's turns, counting the turn it lands on. Omit = until removed. An `applyStatus` can override it. |
| `maxStacks` | whole number ≥ 1 | yes | Reapplying adds a stack, up to this. `1` = reapplying refreshes the duration instead. |
| `modifiers` | list of [modifiers](../EFFECTS.md#modifiers) | no | Stats while it lasts, e.g. +20% attack. |
| `effects` | list of [effects](../EFFECTS.md#effects-when-x-if-y-maybe-do-z) | no | What it does while it lasts. `self` is the bearer. Use `perStack: true` in amounts to scale with stacks. |

Status damage (a tick) never gets `damageDealt` or other general buffs.
Only rules with `damageFromStatus` change it.

## Example: damage over time

```ts
import type { Status } from "#geo/models";

export default {
    id: "poisoned",
    name: "Poisoned",
    duration: 4,
    maxStacks: 3,
    effects: [
        {
            id: "poisoned.tick",
            trigger: { event: "turnStart", as: "actor" },
            actions: [
                {
                    type: "damage",
                    to: "self",
                    amount: { flat: 2, perStack: true },
                    element: "poison",
                    ignoreDefense: true,
                },
            ],
        },
    ],
} satisfies Status;
```

## Example: a buff

```ts
import type { Status } from "#geo/models";

export default {
    id: "stone-skin",
    name: "Stone Skin",
    duration: 3,
    maxStacks: 1,
    modifiers: [{ stat: "defense", kind: "flat", value: 5 }, { stat: "speed", kind: "percent", value: -0.2 }],
} satisfies Status;
```
