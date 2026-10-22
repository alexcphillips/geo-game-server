# Weapons

Main-hand weapons. A weapon gives stats (usually flat attack), decides which
cards can be played (by its type and style), and can unlock exclusive cards.

## Fields

Model: `Weapon` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `weapon.type` | text | yes | e.g. `dagger`, `sword`, `greatsword`. Must be in `config/weapons.ts` `types`. Add new ones there. |
| `weapon.style` | text | yes | e.g. `melee`. Must be in `config/weapons.ts` `styles`. |
| `modifiers` | list of [modifiers](../EFFECTS.md#modifiers) | no | Stats while equipped, e.g. +8 attack. |
| `effects` | list of [effects](../EFFECTS.md#effects-when-x-if-y-maybe-do-z) | no | Procs and passives while equipped. |
| `unlocksCards` | list of card ids | no | Cards only usable while this is equipped. Ids without `card.`, e.g. `heavy-swing`. |
| `skills` | list of `{ skill, level }` | no | Skill levels needed to equip it, e.g. `[{ skill: "combat", level: 5 }]`. Checked on equip however it was got (crafted, bought, looted); a saved loadout skips it until then. |

A card's `requiresWeapon` matches the weapon's type **or** style: a card
needing `["melee"]` works with every melee weapon, and one needing
`["dagger"]` only with daggers.

Weapon speed (fast/slow) isn't a stat: it lives in the cards a weapon
unlocks. A fast weapon gets several small hits (`"hits": 3`), a slow one a
big single hit.

Level requirements to equip don't exist yet. Recipes can require skill
levels (see [recipes](../recipes/README.md)).

## Example

```ts
import type { Weapon } from "#geo/models";

export default {
    id: "ember-blade",
    name: "Ember Blade",
    rarity: "rare",
    icon: "flaming-sword",
    description: "Forged in coals that were never allowed to cool.",
    weapon: { type: "sword", style: "melee" },
    modifiers: [
        { stat: "attack", kind: "flat", value: 10 },
        { stat: "critChance", kind: "flat", value: 0.05 },
    ],
    effects: [
        {
            id: "ember-blade.ignite",
            trigger: { event: "attackFinished", as: "actor" },
            chance: 0.2,
            actions: [{ type: "applyStatus", to: "other", status: "burning" }],
        },
    ],
    unlocksCards: ["heavy-swing"],
    effectText: ["20% chance to set the target Burning after each attack"],
    sellValue: 150,
} satisfies Weapon;
```
