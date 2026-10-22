# Mayors

Everyone votes in one weekly election. The winner's perks apply to every
player while they're in office. Each election's candidates are picked from
these files, leaving out the mayor in office, so there must be more mayors
than `candidates` in [`config/elections.ts`](../config/README.md#electionsts).

## Fields

Model: `Mayor` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id`, `name` | text | yes | |
| `perks` | list of perks | yes | |
| `perks[].id`, `.name`, `.description`, `.icon` | text | yes | Shown in the app. |
| `perks[].modifiers` | list of [modifiers](../EFFECTS.md#modifiers) | yes | Stat changes for every player while in office. `[]` = words only (not built yet). Combat stats reach every fight; `eelChance`, `coinDrops`, `vendorPrices` etc. are read by their rules. |

## Example

```ts
import type { Mayor } from "#geo/models";

export default {
    id: "brannoc",
    name: "Brannoc",
    perks: [
        {
            id: "iron-will",
            name: "Iron Will",
            description: "+5 defense in Runs.",
            icon: "checked-shield",
            modifiers: [{ stat: "defense", kind: "flat", value: 5 }],
        },
        {
            id: "tax-break",
            name: "Tax Break",
            description: "Vendor prices are 10% lower.",
            icon: "price-tag",
            modifiers: [{ stat: "vendorPrices", kind: "percent", value: -0.1 }],
        },
    ],
} satisfies Mayor;
```
