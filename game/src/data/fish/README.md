# Fish

Fish that can bite in a rod fishing Run. Each file also makes the items a
catch becomes, so there are no fish item files:

- `fish.<id>`: the regular, tradable catch (a `fishing` material);
- `fish.<id>.bronze`, `.silver`, `.gold`, `.ruby`: Soulbound quality
  catches, never sold, for the collection log and quests.

Recipes and vendors use those ids, e.g. a recipe taking `fish.trout`.

## Fields

Model: `Fish` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id` | text | yes | Matches the file name. |
| `name`, `icon`, `description` | text | yes | Shown in the app, and on its items. |
| `rarity` | `common` … `legendary` | yes | Which waters it bites in, how often, and how hard quality is. See `config/fishing.ts`. |
| `stamina` | whole number ≥ 1 | yes | How long it fights. |
| `strength` | number > 0 | yes | Scales every move it makes; 1 is normal. |
| `distance` | whole number ≥ 1 | yes | Starting Distance. It escapes at this + 5. |
| `moves` | `{ run, thrash, dive, rest, jump }` | yes | Weights: how often it picks each move. 0 = never. |
| `traits` | list of `slippery` `linebreaker` `deepdiver` | no | Special behaviour (in code). |
| `xp` | whole number ≥ 0 | yes | Fishing XP for landing one. |

How often each rarity bites, which water allows which rarities, quality
thresholds and par turns are in [`config/fishing.ts`](../config/README.md#fishingts).

## Example

```ts
import type { Fish } from "#geo/models";

export default {
    id: "zander",
    name: "Zander",
    rarity: "uncommon",
    icon: "salmon",
    description: "Glassy-eyed and night-hungry. It hunts what hides.",
    stamina: 5,
    strength: 1.05,
    distance: 6,
    moves: { run: 3, thrash: 2, dive: 2, rest: 2, jump: 0 },
    xp: 25,
} satisfies Fish;
```
