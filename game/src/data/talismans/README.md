# Talismans

Talismans count only while in the Talisman Bag, which holds one copy of
each, so duplicates never stack. They're never equipped.

## Fields

Model: `Talisman` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `modifiers` | list of [modifiers](../EFFECTS.md#modifiers) | no | Stats while in the bag. Non-combat stats (e.g. `eelChance`) count too. |
| `effects` | list of [effects](../EFFECTS.md#effects-when-x-if-y-maybe-do-z) | no | Procs and passives in fights. |

Many existing talismans are `effectText` only: their rule isn't built yet,
so they do nothing. A talisman with `modifiers` or `effects` works today.

## Example: a stat talisman

```ts
import type { Talisman } from "#geo/models";

export default {
    id: "iron-heart",
    name: "Iron Heart",
    rarity: "uncommon",
    icon: "heart-plus",
    description: "Heavy in the pocket, steady in the chest.",
    modifiers: [{ stat: "maxHealth", kind: "percent", value: 0.05 }],
} satisfies Talisman;
```

## Example: a proc talisman

```ts
import type { Talisman } from "#geo/models";

export default {
    id: "frost-fang",
    name: "Frost Fang",
    rarity: "epic",
    icon: "frozen-orb",
    description: "Cold enough to stop a heart. Briefly.",
    effects: [
        {
            id: "frost-fang.freeze",
            trigger: { event: "attackFinished", as: "actor" },
            conditions: [{ type: "lacksStatus", who: "target", status: "frozen" }],
            chance: 0.1,
            actions: [{ type: "applyStatus", to: "other", status: "frozen" }],
        },
    ],
    effectText: ["10% chance to freeze the target after you attack"],
} satisfies Talisman;
```
