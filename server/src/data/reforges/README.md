# Reforges

A reforge is a named bonus on one copy of a weapon or piece of armor, e.g. a
**Heavy** Iron Helm. A vendor with a `reforge` cost (the Blacksmith) rolls
one at random onto a copy for coins, never the one it already has. The bonus
is added to the item's own stats and goes with the copy if it's sold on the
Market.

## Fields

Model: `Reforge` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id`, `name` | text | yes | The name goes before the item's: "Heavy Iron Helm". |
| `appliesTo` | list of `weapon` `armor` | yes | Armor is the off hand, head, chest, hands and legs. Rings take none. |
| `modifiers` | `{ common, uncommon, rare, epic, legendary }`, each a list of modifiers | yes | Its stat changes on an item of that rarity. See [EFFECTS.md](../EFFECTS.md) for stats. |

A vendor that reforges needs at least two reforges for each of weapons and
armor, so a reroll always has somewhere to go.

## Example

```ts
import type { Reforge } from "#geo/models";

export default {
    id: "keen",
    name: "Keen",
    appliesTo: ["weapon"],
    modifiers: {
        common: [{ stat: "critChance", kind: "flat", value: 0.03 }],
        uncommon: [{ stat: "critChance", kind: "flat", value: 0.04 }],
        rare: [{ stat: "critChance", kind: "flat", value: 0.06 }],
        epic: [{ stat: "critChance", kind: "flat", value: 0.08 }],
        legendary: [{ stat: "critChance", kind: "flat", value: 0.1 }],
    },
} satisfies Reforge;
```
