# Recipes

Crafting and cooking. Each craft uses up the inputs and makes the output.
Skill levels are required, never spent. Players craft from the app's
crafting screen.

Sort them into a folder per skill (`recipes/combat/`, `recipes/cooking/`,
`recipes/farming/`, `recipes/fishing/`…). A recipe with no skill level goes
in the folder of the skill its output belongs to (farming cards in
`farming/`). Farm structures aren't crafted: their cost is in their own file
(`structures/`). The folder is only for tidiness; the `skills` field is
what gates it.

Compact recipes (100 Silk Spool → 1 Compact Silk Spool) come from a
material's `compact` field, so they have no file here.

## Fields

Model: `Recipe` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id` | text | yes | Matches the file name. Usually the output's id. |
| `inputs` | list of `{ itemId, quantity }` (at least 1) | yes | Used up per craft. Each item once. |
| `output` | `{ itemId, quantity }` | yes | What one craft makes. |
| `skills` | list of `{ skill, level }` | no | Levels needed, e.g. Combat 5. Max level is 50. |
| `station` | `cooking` | no | Where it's made. `cooking` lists it on the Cooking menu (and still in item uses). Omit for the crafting screen. |
| `xp` | `{ skill, amount }` | no | Skill XP per craft, e.g. `{ skill: "cooking", amount: 5 }`. |

Item ids are the item's own id. A card is `card.<id>`, a fish
`fish.<id>`, a compact material `compact-<id>`
(see [ids](../README.md#ids-and-references)).

## Example: cooking

```ts
import type { Recipe } from "#geo/models";

export default {
    id: "trout-skewers",
    inputs: [{ itemId: "fish.trout", quantity: 2 }, { itemId: "oak-logs", quantity: 1 }],
    output: { itemId: "grilled-trout", quantity: 3 },
    skills: [{ skill: "cooking", level: 2 }],
    station: "cooking",
    xp: { skill: "cooking", amount: 15 },
} satisfies Recipe;
```

## Example: smelting

```ts
import type { Recipe } from "#geo/models";

export default {
    id: "iron-bar",
    inputs: [{ itemId: "iron-ore", quantity: 2 }, { itemId: "coal", quantity: 1 }],
    output: { itemId: "iron-bar", quantity: 1 },
    skills: [{ skill: "mining", level: 3 }],
} satisfies Recipe;
```

## Example: crafting a card

```ts
import type { Recipe } from "#geo/models";

export default {
    id: "fireball",
    inputs: [{ itemId: "ruby", quantity: 1 }, { itemId: "coal", quantity: 20 }],
    output: { itemId: "card.fireball", quantity: 1 },
    skills: [{ skill: "combat", level: 10 }],
} satisfies Recipe;
```

Every item must exist. `iron-bar` here would need a file in `materials/`
first (that guide has one).
