# Rules: stats, modifiers, actions and effects

Every rule in the game is built from the same few pieces, wherever it
appears: a card, a weapon, a talisman, food, a status or an enemy. A new item
almost never needs code. If a rule needs a piece that isn't listed here,
it's an engine change (`engine/engine.types.ts` and `engine/battle.ts`).

## Stats

A stat is any name. These are the ones the game reads today:

| Stat | Read by | Notes |
| --- | --- | --- |
| `maxHealth` | combat | |
| `attack` | combat | What `{ stat: "attack" }` amounts scale off. |
| `defense` | combat | Taken off every hit, unless `ignoreDefense`, but never below 25% of the hit (`MIN_DAMAGE_SHARE` in `engine/engine.types.ts`). |
| `speed` | combat | Turn order: fastest first. |
| `critChance` | combat | 0–1. Attacks only. |
| `critMultiplier` | combat | e.g. 1.5. |
| `counterChance` | combat | 0–1. After being attacked, the chance to strike back for `counterDamage` × attack (crits and defense as usual). One roll per attack, however many hits; counters are never countered. |
| `counterDamage` | combat | A counter's share of attack, e.g. 0.5. Players start at 0.5 (`config/player.ts`); an enemy without it uses 0.5. |
| `damageDealt` | combat | Fraction: 0.25 = 25% more damage. Never on status damage. Combat level gives 1% a level. |
| `armorPen` | combat | Flat defense ignored by attacks: 2 against defense 4 meets 2. Per hit, never below 0 defense; counters count. Damage that already ignores defense is unaffected. |
| `intelligence` | combat | Magic power. Nothing reads it by itself: scale a card off it with `{ stat: "intelligence" }`. |
| `mending` | combat | Fraction: 0.1 = heals you receive are 10% bigger. Never food's own heals (a status a food applies, like Well Fed, is boosted). |
| `magicFind` | combat rewards | Rare drops only: a loot-list or chest-offer chance under 5% × (1 + magicFind / 100), so +1 = 1% likelier, never past 5%. Commoner drops are untouched. |
| `eelChance` `baitSaveChance` `seaCreatureChance` | fishing | Added to `config/fishing.ts` `baseOdds`. |
| `farmingFortune` | farming | Flat: each 100 adds a harvest's crops again (1000 = ×11); the leftover fraction is a chance of 1 more. Not seeds. |
| `pestChance` `mutationChance` | farming | Multipliers on 1: percent -0.25 = pests 25% less likely to arrive (forced swarms ignore it); +0.25 = every mutation 25% likelier to sprout (Coax too). |
| `coinDrops` | combat rewards | Global (mayor) modifiers only. |
| `vendorPrices` | vendors | Global (mayor) modifiers only. |

Any other name (e.g. `extraOreChance`) is allowed, but nothing reads it yet.
That's how placeholder mayor perks work.

## Modifiers

Gear, talismans, statuses and mayor perks change stats with `modifiers`:

```
modifiers: [
    { stat: "attack", kind: "flat", value: 4 },
    { stat: "maxHealth", kind: "percent", value: 0.1 }
]
```

The result is `(base + all flat) × (1 + all percent)`, so the example adds 4
attack and 10% max health. Fraction stats such as `critChance` use flat:
`{ stat: "critChance", kind: "flat", value: 0.05 }` adds 5%.

## Amounts

Wherever an action takes an `amount`:

- `10` is a flat 10;
- `{ stat: "attack", multiplier: 1.5 }` is 150% of the owner's attack;
- `{ stat: "attack", multiplier: 0.5, flat: 3 }` is half of attack, plus 3;
- `{ flat: 3, perStack: true }` is 3 per stack of the status it comes
  from (Burning).

## Actions

`to` / `from` say who it happens to. Who that is depends on the owner of
the rule:

| Who | Means |
| --- | --- |
| `self` | The owner: the player playing the card, the enemy with the effect, the bearer of the status. |
| `other` | The owner's counterpart: the enemy when you attack it, the attacker when you're hit. |
| `actor` / `target` | Whoever caused the event, or whoever it happened to. |

| Action | Fields | Does |
| --- | --- | --- |
| `attack` | `to`, `amount`, `hits`?, `element`?, `delivery`? (`melee`/`projectile`, animation only) | A weapon blow: can crit, meets defense, and fires `attacked`. `hits` repeats it, each hit rolling its own crit. |
| `damage` | `to`, `amount`, `element`?, `ignoreDefense`? | Damage that isn't an attack: no crit, and no `attacked` event, so procs can't chain off it. |
| `heal` | `to`, `amount` | Never past max health. |
| `guard` | `to`, `amount` | Absorbs the next hits until used up. Lapses at the bearer's next turn. |
| `barrier` | `to`, `amount` | Sets the target's barrier to `amount` (a recast replaces what's left, never adds). Soaks damage after guard and before health, and lasts the fight until broken. Shown as gold over the health bar. |
| `applyStatus` | `to`, `status`, `stacks`?, `duration`? | `duration` overrides the status's own. |
| `removeStatus` | `from`, `status` | |
| `cancelAction` | | In `beforeAction`: the turn is skipped (Frozen). |
| `freeCharge` | | In `cardPlayed`: this play costs no charge. |
| `modifyDamage` | `add`?, `multiply`? | In `beforeDamage`: (damage + add) × multiply. |

## Effects: "when X, if Y, maybe, do Z"

Passive rules are `effects`. Each one has a trigger, optional conditions,
an optional chance, and the actions:

```
effects: [
    {
        id: "storm-charm.lightning",
        trigger: { event: "attacked", as: "target" },
        chance: 0.3,
        actions: [{ type: "damage", to: "other", amount: 10, element: "lightning", ignoreDefense: true }]
    }
]
```

That one reads: when I'm attacked, 30% of the time, deal 10 lightning
damage to the attacker. `id` is only for logs; use `<file id>.<what>`.

### Triggers

`as` is the owner's part in the event: `actor`, `target` or `any` (the
default).

| Event | When | actor → target |
| --- | --- | --- |
| `battleStart` | once, before the first turn | |
| `turnStart` | someone's turn begins | whose turn |
| `beforeAction` | just before they act (`cancelAction` here skips the turn) | who's acting |
| `cardPlayed` | a card is played. Only the card's own effects and the player's gear hear it. | player → target |
| `foodEaten` | food is eaten from the lunchbox | eater → eater |
| `attacked` | an attack is about to land | attacker → defender |
| `beforeDamage` | damage is being worked out (`modifyDamage` here) | source → target |
| `damageTaken` | damage was dealt | source → target |
| `attackFinished` | an attack fully resolved, after all its hits | attacker → defender |
| `turnEnd` | a turn is over; status durations tick down | whose turn |
| `defeated` | someone hit 0 health | killer → defeated |

### Conditions

All conditions in the list must hold. Use `any` for "or" and `not` for "not".

| Condition | Fields | Holds when |
| --- | --- | --- |
| `hasStatus` / `lacksStatus` | `who`, `status` | They have / don't have the status. |
| `healthBelow` | `who`, `fraction` | Health ≤ fraction × max health. |
| `cardHasTag` | `tag` | The card played carries the tag (e.g. `fire`). |
| `foodHasTag` | `tag` | The food eaten carries the tag (e.g. `spicy`). |
| `damageElement` | `element` | The damage is of this element. |
| `damageFromStatus` | `status`? | The damage comes from a status tick (any, or this one). |
| `not` | `condition` | The inner condition doesn't hold. |
| `any` | `conditions` | At least one holds. |

Example: a card that's free against a Burning target.

```
effects: [
    {
        id: "fireball.free-if-burning",
        trigger: { event: "cardPlayed", as: "actor" },
        conditions: [{ type: "hasStatus", who: "target", status: "burning" }],
        actions: [{ type: "freeCharge" }]
    }
]
```

## Rules of thumb

- Status damage (a Burning tick) never gets `damageDealt` or any other
  general buff. To change it, use a `beforeDamage` effect with
  `damageFromStatus`.
- Durations count the bearer's turns, including the turn it lands on, so
  4 = "the next 3 turns" when applied on your own turn.
- Chances are 0–1: `0.3` is 30%.
