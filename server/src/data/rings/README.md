# Rings

Worn in the ring slot. Same rules as armor, without `slot`.

## Fields

Model: `Ring` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `modifiers` | list of [modifiers](../EFFECTS.md#modifiers) | no | Stats while worn. |
| `effects` | list of [effects](../EFFECTS.md#effects-when-x-if-y-maybe-do-z) | no | Procs and passives while worn. |
| `unlocksCards` | list of card ids | no | Cards only usable while this is worn. |
| `skills` | list of `{ skill, level }` | no | Skill levels needed to equip it, e.g. `[{ skill: "combat", level: 5 }]`. Checked on equip however it was got (crafted, bought, looted); a saved loadout skips it until then. |

Magic Power and "chance to not spend a charge" aren't built yet, so the
existing rings show them as `stats` / `effectText` only. A ring that saves
charges can be a `cardPlayed` effect with a `chance` and `freeCharge`:

## Example

```ts
import type { Ring } from "#geo/models";

export default {
    id: "thrifty-band",
    name: "Thrifty Band",
    rarity: "rare",
    icon: "ring",
    description: "Whoever made it counted every coin twice.",
    effects: [
        {
            id: "thrifty-band.save-charge",
            trigger: { event: "cardPlayed", as: "actor" },
            chance: 0.05,
            actions: [{ type: "freeCharge" }],
        },
    ],
    effectText: ["5% chance to not spend a card charge"],
} satisfies Ring;
```
