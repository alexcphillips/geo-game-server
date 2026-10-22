# Pets

Pets work like Hypixel SkyBlock's. One pet is active at a time and gives its
stats; pets never fight. Each pet makes one item per rarity it comes in,
`pet.<id>.<rarity>` (e.g. `pet.tarantula.common`). Loot, recipes, vendors
and the Market name those.

Each owned copy keeps its own XP and held item. While active, it gains XP
whenever its owner earns skill XP: all of it from its own `skill`, and a
share of every other skill's (`config/pets.ts`). Its level (1–100) comes
from that XP and its rarity, so a rarer pet levels slower. Kat (a vendor with
`petUpgrades`) raises a copy one rarity for coins, materials and real hours.
It keeps its XP, so its level can drop.

## Fields

Model: `Pet` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field                 | Type                                                  | Required? | What it does                                                                         |
| --------------------- | ----------------------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| `id`                  | text                                                  | yes       | Must match the file name. Items are `pet.<id>.<rarity>`.                             |
| `name`, `description` | text                                                  | yes       | Shown in the app.                                                                    |
| `icon`                | Game Icons name                                       | yes       | For lists that don't draw the pet's art.                                             |
| `image`               | text                                                  | yes       | The app's art: `features/items/art/pets/<image>.png` in geo-game (`npm run item-art`). |
| `skill`               | skill                                                 | yes       | It gains full XP from this skill.                                                    |
| `rarities`            | list of rarities, lowest first                        | yes       | The rarities it comes in; Kat raises it through these.                               |
| `stats`               | list of [pet stats](#pet-stats)                       | yes       | Stats that grow with level. Can be empty.                                            |
| `abilities`           | list of `{ id, name, from, description, modifiers? }` | yes       | Named stat bonuses from rarity `from` up. `modifiers` are [pet stats](#pet-stats).   |
| `sellValue`           | `{ rarity: coins }`                                   | no        | What an NPC pays, per rarity. Unset = the rarity placeholder.                        |
| `upgrades`            | `{ rarity: { coins, items?, hours } }`                | no        | Kat's price to raise it from each rarity. Unset = `config/pets.ts` `upgrades`.       |

## Pet stats

`{ stat, kind?, perLevel }`: `perLevel` × the pet's level. At level 100 a
`perLevel` of `0.3` is +30. `kind` is `"flat"` (default) or `"percent"`, which
takes a fraction (`0.001` per level is +10% at 100). `perLevel` is one number
for every rarity, or `{ rare: 0.1, legendary: 0.2 }` per rarity.

## Example

```ts
import type { Pet } from "#geo/models";

export default {
    id: "tarantula",
    name: "Tarantula",
    icon: "spider-alt",
    image: "tarantula",
    description: "Eight legs, eight eyes, and an opinion about all of it.",
    skill: "combat",
    rarities: ["common", "uncommon", "rare", "epic", "legendary"],
    stats: [{ stat: "defense", perLevel: 0.2 }],
    abilities: [
        {
            id: "venom-sacs",
            name: "Venom Sacs",
            from: "rare",
            description: "Hit harder.",
            modifiers: [
                {
                    stat: "attack",
                    kind: "percent",
                    perLevel: { rare: 0.001, epic: 0.0015, legendary: 0.002 },
                },
            ],
        },
    ],
} satisfies Pet;
```
