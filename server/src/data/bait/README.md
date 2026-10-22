# Bait

Packed into the bait slots before fishing. One is used per cast, unless
`baitSaveChance` saves it. Bait is optional: a cast with none packed is a
bare hook, which only hooks commons, never a sea creature, and never lands a
quality catch. Any bait opens the water's full range (up to the rod's cap).

## Fields

Model: `Bait` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `scent` | whole number ≥ 0 | yes | PLACEHOLDER: shown, but no rule reads it yet. |
| `chum` | `true` / `false` | no | Draws sea creatures and makes the bite come sooner. |
| `stackSize` | whole number ≥ 1 | no (default 99) | How many fit in one stack. |

## Example

```ts
import type { Bait } from "#geo/models";

export default {
    id: "glow-grub",
    name: "Glow Grub",
    rarity: "uncommon",
    icon: "caterpillar",
    description: "It lights up the water. Things notice.",
    stats: [{ label: "Scent", value: "+2" }],
    scent: 2,
    sellValue: 2,
} satisfies Bait;
```
