# Materials

Things you gather or loot and craft with: ore, logs, fangs, crops. Sort
them into a folder per skill (`materials/mining/`…). A material sits in its
skill's inventory sub-tab, stacks, and is sold on the Market in pooled
stacks.

Fish have their own folder ([fish](../fish/README.md)), which makes their
items.

## Fields

Model: `Material` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `skill` | text | yes | Its inventory sub-tab. |
| `stackSize` | whole number ≥ 1 | no (default 999) | How many fit in one stack. |
| `compact` | `{ "ratio": n }` | no | Also makes a **Compact** version, `compact-<id>`, and the recipe that presses `n` of this into one. One-way. It's worth exactly `n` × this. |

## How materials are made

- Dropped by enemies (`loot` / `chests` in [enemies](../enemies/README.md)).
- Crafted by a [recipe](../recipes/README.md) that outputs it, e.g. smelting
  ore into a bar.
- Gathered in skill Runs, once those exist (mining, farming, foraging).
- Sold by a [vendor](../vendors/README.md).

## Example

```ts
import type { Material } from "#geo/models";

export default {
    id: "iron-bar",
    name: "Iron Bar",
    rarity: "common",
    icon: "metal-bar",
    description: "Smelted from iron ore. The start of most things worth having.",
    skill: "mining",
    sellValue: 8,
    compact: { ratio: 100 },
} satisfies Material;
```

It goes in `materials/mining/iron-bar.ts`. The recipe to smelt it is in
[recipes](../recipes/README.md#example-smelting).
