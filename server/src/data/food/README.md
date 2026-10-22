# Food

Food is packed into the lunchbox before a Run. In a Run, the lunchbox
button eats one, which **uses your turn**. Effects happen at once.

## Fields

Model: `Food` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `heal` | whole number ≥ 1 | no | Heals the eater this much, never past max health. Also adds a "Heals" row to the item page. Mending never raises it. |
| `actions` | list of [actions](../EFFECTS.md#actions) | no | Done after the heal. `self` is the eater. Usually `applyStatus` for a buff that lasts. |
| `effects` | list of [effects](../EFFECTS.md#effects-when-x-if-y-maybe-do-z) | no | Food-only rules, heard only as this food is eaten (`foodEaten`). |
| `tags` | list of text | no | e.g. `spicy`, `fish`, `hearty`. Gear can react with `foodHasTag`, e.g. "spicy food heals 20% more". |
| `stackSize` | whole number ≥ 1 | no (default 99) | How many fit in one stack. A lunchbox slot holds up to 10. |

Food is eaten from the lunchbox, in a fight (as a turn) or between fights.
Between fights it runs the same way, but only its effect on health is kept:
heals count, and so does harm (e.g. `{ type: "damage", to: "self", amount: 20 }`),
which stops at 1 HP. Buffs and statuses only work in a fight, so a food that
hurts you for a buff is one to eat mid-fight.

A lasting buff is a **status**: make it in [statuses](../statuses/README.md)
(e.g. `well-fed`: heals 8 a turn), then apply it here. Status durations count
the eating turn, so `"duration": 4` = your next 3 turns. Describe it in
`effectText` and `stats` so players see it.

## How food is made

Cooking is a [recipe](../recipes/README.md) that outputs the food, e.g. one
Whole Trout → one Grilled Trout. Food can also be sold by a vendor (bread
from the Baker) or dropped as loot.

## Example: plain healing

```ts
import type { Food } from "#geo/models";

export default {
    id: "apple-pie",
    name: "Apple Pie",
    rarity: "common",
    icon: "pie-slice",
    description: "Still warm. Someone's grandmother would be proud.",
    heal: 40,
    tags: ["sweet"],
    sellValue: 6,
} satisfies Food;
```

## Example: heal plus a buff

```ts
import type { Food } from "#geo/models";

export default {
    id: "chilli-stew",
    name: "Chilli Stew",
    rarity: "uncommon",
    icon: "hot-meal",
    description: "Your eyes water. Your arms feel stronger.",
    heal: 20,
    tags: ["spicy", "hearty"],
    actions: [
        { type: "applyStatus", to: "self", status: "spiced" },
        { type: "applyStatus", to: "self", status: "well-fed" },
    ],
    effectText: [
        "Spiced: Attack +20% for your next 3 turns",
        "Well Fed: heals 8 at the start of each of your next 3 turns",
    ],
} satisfies Food;
```

Satiety (a limit on how much you can eat) is planned but not built.
