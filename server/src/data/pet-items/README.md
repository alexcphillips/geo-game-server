# Pet items

Held by a pet, one per pet, adding to what it gives while active. Giving one
to a pet uses it up. Giving another hands the old one back, and taking one off
costs coins by its rarity (`config/pets.ts` `heldItemRemovalCost`).

## Fields

Model: `PetItem` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `modifiers` | list of [modifiers](../EFFECTS.md#modifiers) | no | Stats while held by the active pet. |
| `xpBoost` | `{ multiplier, skill? }` | no | Multiplies the pet's XP gain; `skill` limits it to that skill's XP. |
| `stackSize` | number | no | Default 64. |

## Example

```ts
import type { PetItem } from "#geo/models";

export default {
    id: "silk-collar",
    name: "Silk Collar",
    rarity: "uncommon",
    icon: "spider-web",
    description: "A pet wearing it learns faster in a fight.",
    xpBoost: { multiplier: 1.2, skill: "combat" },
} satisfies PetItem;
```
