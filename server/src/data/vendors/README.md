# Vendors

NPC shops in the Town Hub. A vendor sells a fixed list at fixed prices. Every
vendor buys any item with an NPC sell value (its `sellValue`, or the rarity
placeholder) that isn't Soulbound, paying that value.

## Fields

Model: `Vendor` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id`, `name`, `icon`, `description` | text | yes | Shown in the app. |
| `sells` | list of `{ itemId, price, tab? }` | yes | Coins each, unlimited stock. Can be empty. `tab` lists it under its own buy tab ("Weapons"); untabbed offers go under "Buy". |
| `reforge` | `{ cost: { common, uncommon, rare, epic, legendary } }` | no | Gives the vendor a Reforge tab: coins per reroll by the item's rarity. See [reforges](../reforges/README.md). |
| `petUpgrades` | `true` | no | Gives the vendor a Pets tab to raise a pet one rarity, at the pet's Kat price (see [pets](../pets/README.md)). |

The server refuses to start if anything sells for less than vendors
pay for it, which would print coins. The mayor's `vendorPrices` perks
change prices but never go under that floor.

## Example

```ts
import type { Vendor } from "#geo/models";

export default {
    id: "blacksmith",
    name: "Blacksmith",
    icon: "anvil",
    description: "Sells what she makes. Buys what you dig up.",
    sells: [
        { itemId: "bronze-dagger", price: 50, tab: "Weapons" },
        { itemId: "leather-belt", price: 60, tab: "Armor" },
    ],
    reforge: { cost: { common: 100, uncommon: 250, rare: 1000, epic: 4000, legendary: 15000 } },
} satisfies Vendor;
```
