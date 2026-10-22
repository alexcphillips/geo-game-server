# Rods

Fishing rods, held in the main hand like a weapon (a rod is no weapon, so
fights with one in hand are fought with fists). You can't fish without one;
players keep one in a fishing loadout in the wardrobe. The rod
decides which fish a cast can hook and the best quality it can land, so a
better rod is how you move up to rarer, pricier fish.

Every player starts with the Twig Rod (`config/starter-kit.ts`): commons
only, no quality catches. The Angler sells the rest.

## Fields

Model: `Rod` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `rod.power` | whole number ≥ 0 | yes | Added to the fishing level for Fishing Power: reels faster and tires fish quicker. |
| `rod.line` | whole number ≥ 1 | yes | Line strength: the Tension cap. The sweet zone scales with it. |
| `rod.maxRarity` | `common` … `legendary` | yes | The rarest fish it can hook. A rarer bite re-rolls among the rarities it can (the water still limits them too). |
| `rod.maxTier` | `bronze` `silver` `gold` `ruby`, or `null` | yes | The best quality it can land. `null`: never a quality catch. |
| `modifiers` | list of [modifiers](../EFFECTS.md#modifiers) | no | Stats while worn. |
| `effects` | list of [effects](../EFFECTS.md#effects-when-x-if-y-maybe-do-z) | no | Procs and passives while worn. |
| `unlocksCards` | list of card ids | no | Cards only usable while this is worn. |
| `skills` | list of `{ skill, level }` | no | Skill levels needed to equip it, e.g. `[{ skill: "combat", level: 5 }]`. Checked on equip however it was got (crafted, bought, looted); a saved loadout skips it until then. |

Rods take no reforges.

## Example

```ts
import type { Rod } from "#geo/models";

export default {
    id: "ashwood-rod",
    name: "Ashwood Rod",
    rarity: "uncommon",
    icon: "fishing-pole",
    description: "Springy ash with a proper reel.",
    rod: { power: 7, line: 12, maxRarity: "uncommon", maxTier: "bronze" },
    sellValue: 60,
} satisfies Rod;
```
