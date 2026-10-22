# Amulets

Worn in the amulet slot, one at a time. Same rules as rings. Amulets take no
reforges.

## Fields

Model: `Amulet` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `modifiers` | list of [modifiers](../EFFECTS.md#modifiers) | no | Stats while worn. |
| `effects` | list of [effects](../EFFECTS.md#effects-when-x-if-y-maybe-do-z) | no | Procs and passives while worn. |
| `unlocksCards` | list of card ids | no | Cards only usable while this is worn. |
| `skills` | list of `{ skill, level }` | no | Skill levels needed to equip it, e.g. `[{ skill: "combat", level: 5 }]`. Checked on equip however it was got (crafted, bought, looted); a saved loadout skips it until then. |

## Example

```ts
import type { Amulet } from "#geo/models";

export default {
    id: "wardens-locket",
    name: "Warden's Locket",
    rarity: "uncommon",
    icon: "gem-pendant",
    description: "Someone's portrait inside, rubbed away by a thumb.",
    modifiers: [{ stat: "maxHealth", kind: "flat", value: 10 }],
} satisfies Amulet;
```
