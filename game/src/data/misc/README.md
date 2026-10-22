# Misc items

Anything that isn't gear, a card, a material, food or bait: keys, nets, a
Rift Lens. Nothing reads these yet beyond owning, crafting, trading and
selling them.

## Fields

Model: `MiscItem` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `kind` | `misc` / `consumable` | no (default `misc`) | Which inventory tab it sits in. `consumable` is for things like potions that aren't food. |
| `stackSize` | whole number ≥ 1 | no (default 99) | How many fit in one stack. |

## Example

```ts
import type { MiscItem } from "#geo/models";

export default {
    id: "iron-chest-key",
    name: "Iron Chest Key",
    rarity: "uncommon",
    icon: "key",
    description: "Solid, square, and slightly too big for any lock you've seen.",
    stats: [{ label: "Opens", value: "Iron chests" }],
} satisfies MiscItem;
```
