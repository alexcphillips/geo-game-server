# Cards

One file is one card: its rules, and the item players own and trade. The
item's id is `card.<id>`, so `fireball.ts` makes the item `card.fireball`.
Sort them into a folder per skill: `cards/combat/`, `cards/fishing/`…

Cards are a fixed hand: players pick up to 5 per skill before a Run. Each
copy has its own charges, spent only when played. At 0 the card fades.

## Fields

Model: `Card` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Plus the [fields every item has](../README.md#fields-every-item-has).

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `skill` | text | yes | Which hand it goes in: `combat`, `fishing`, `mining`, `farming`, `foraging`. |
| `maxCharges` | whole number ≥ 1 | yes | Plays before it fades. |
| `targets` | `enemy` / `self` | yes | Who the player aims it at. |
| `actions` | list of [actions](../EFFECTS.md#actions) | no (default none) | What playing it does, in order. |
| `effects` | list of [effects](../EFFECTS.md#effects-when-x-if-y-maybe-do-z) | no | Card-only rules, heard only when this card is played (e.g. free against Burning). |
| `tags` | list of text | no | e.g. `fire`, for `cardHasTag` conditions on gear and statuses. |
| `requiresWeapon` | list of weapon types/styles | no | The wielded weapon must carry one of these, e.g. `["dagger"]` or `["melee"]`. Listed in `config/weapons.ts`. Omit = playable with anything. |
| `requiresOffHand` | list of off-hand types | no | The off-hand must be one of these, e.g. `["shield"]`. Listed in `config/weapons.ts` (`offHandTypes`). With `requiresWeapon` too, both must hold. Omit = no off-hand needed. |
| `playableIf` | list of [conditions](../EFFECTS.md#conditions) | no | All must hold to play it; the app greys it out otherwise. `self` is you, `other` the target. e.g. `[{ type: "lacksStatus", who: "self", status: "venom-coat" }]` stops a self-buff being recast while it lasts, and frees it again if an enemy strips it. |
| `finesse` | `raises` / `lowers` | no | Fishing cards only: shown on the card. |

Weapon-exclusive cards: list the card in the weapon's `unlocksCards`
(see [weapons](../weapons/README.md)).

## Example: a combat card

```ts
import type { Card } from "#geo/models";

export default {
    id: "searing-cut",
    name: "Searing Cut",
    rarity: "uncommon",
    icon: "flaming-sword",
    description: "A blade heated until it glows. The wound keeps burning.",
    stats: [{ label: "Damage", value: "90% of Attack" }, { label: "Applies", value: "Burning" }],
    skill: "combat",
    maxCharges: 40,
    targets: "enemy",
    tags: ["fire"],
    requiresWeapon: ["sword"],
    actions: [
        {
            type: "attack",
            to: "other",
            amount: { stat: "attack", multiplier: 0.9 },
            element: "fire",
            delivery: "melee",
        },
        { type: "applyStatus", to: "other", status: "burning" },
    ],
} satisfies Card;
```

## Example: a defensive card

```ts
import type { Card } from "#geo/models";

export default {
    id: "second-wind",
    name: "Second Wind",
    rarity: "rare",
    icon: "heart-plus",
    description: "Catch your breath. Hit harder for it.",
    skill: "combat",
    maxCharges: 15,
    targets: "self",
    actions: [{ type: "heal", to: "self", amount: 20 }, { type: "guard", to: "self", amount: 5 }],
} satisfies Card;
```

## Fishing cards

A fishing card's rules are code (`fishing/fishing-run.ts`), not `actions`,
until the fishing engine is data-driven. A file in `cards/fishing/` sets
its name, charges, rarity and text. Its id must be one the code knows
(`fish.reel`, `fish.gaff`…). A new fishing card needs code. Describe it in
`stats` (Role / Does), as the existing ones do.

## Farming cards

Like fishing, a farming card's rules are code (`farming/farm.ts`), and its
shape (`tile`, `row`, `square3`, `ring`, `cross`, `none`) is in
`content/farming.ts` (`FARMING_CARDS`). A file in `cards/farming/` sets its
name, charges, rarity and text, and its id must be one the code knows
(`farm.swat`…). A new farming card needs code.

Farming cards cost no Labor. Each plays once a farm cycle, and a cycle
allows 5 plays in all (the hand's size), tracked on the farm: moving a
played card out of the hand and back, or swapping others in, gives no
extra plays.

Mining and foraging cards have no Runs yet. Their files exist so players
can own and pack them, and they do nothing.

## How players get cards

From a vendor (`vendors/`, selling `card.<id>`), a recipe (`recipes/`,
outputting `card.<id>`), enemy loot or chests, or the starter kit.
