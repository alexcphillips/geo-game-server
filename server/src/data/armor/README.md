# Armor and shields

Everything worn that isn't a main-hand weapon, a ring or an amulet: shields
(off hand), helmets, shoulders, chest pieces, gloves, leg armor, boots, cloaks and belts.

## Folders

One folder per slot, named after it: `head/`, `shoulders/`, `chest/`,
`hands/`, `legs/`, `feet/`, `cloak/`, `belt/`, and `off-hand/` for shields.
A file goes in the folder of its `slot`; the server refuses to start if it's
in another. Make a folder the first time a slot gets an item.

## Fields

Model: `Armor` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `slot` | `offHand` `head` `shoulders` `chest` `hands` `legs` `feet` `cloak` `belt` | yes | Where it's worn. Shields are `offHand`. |
| `offHand` | `{ type }` | no | Off-hand only: its type from `config/weapons.ts` `offHandTypes`, e.g. `{ type: "shield" }`. Cards with `requiresOffHand` need it. |
| `modifiers` | list of [modifiers](../EFFECTS.md#modifiers) | no | Stats while worn, e.g. +6 defense. |
| `effects` | list of [effects](../EFFECTS.md#effects-when-x-if-y-maybe-do-z) | no | Procs and passives while worn. |
| `unlocksCards` | list of card ids | no | Cards only usable while this is worn, e.g. a shield's `guard`. |
| `skills` | list of `{ skill, level }` | no | Skill levels needed to equip it, e.g. `[{ skill: "combat", level: 5 }]`. Checked on equip however it was got (crafted, bought, looted); a saved loadout skips it until then. |

## Example: a shield

```ts
import type { Armor } from "#geo/models";

export default {
    id: "spiked-buckler",
    name: "Spiked Buckler",
    rarity: "uncommon",
    icon: "spiked-shield",
    description: "Small, round, and rude.",
    slot: "offHand",
    offHand: { type: "shield" },
    modifiers: [{ stat: "defense", kind: "flat", value: 4 }],
    effects: [
        {
            id: "spiked-buckler.thorns",
            trigger: { event: "attacked", as: "target" },
            actions: [{ type: "damage", to: "other", amount: 2, ignoreDefense: true }],
        },
    ],
    unlocksCards: ["guard"],
    effectText: ["Attackers take 2 damage"],
} satisfies Armor;
```

## Example: a helmet

```ts
import type { Armor } from "#geo/models";

export default {
    id: "steel-helm",
    name: "Steel Helm",
    rarity: "uncommon",
    icon: "visored-helm",
    description: "Polished enough to see yourself in. Worth it.",
    slot: "head",
    modifiers: [{ stat: "defense", kind: "flat", value: 7 }, { stat: "maxHealth", kind: "flat", value: 10 }],
} satisfies Armor;
```
