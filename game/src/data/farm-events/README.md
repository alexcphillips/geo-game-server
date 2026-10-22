# Farm events

Things that happen to one farm. From `config/farming.ts` `events.fromTurn`,
each turn may telegraph an event for the next turn (`events.chance`),
picked by `weight`. The player sees it coming and can plan for it.

Model: `FarmEvent` in `#geo/models` (`content/models.ts`).

| `effect` | When | What it does |
| --- | --- | --- |
| `{ kind: "pest-swarm", count }` | Its turn | `count` extra pests arrive, past the usual cap. |
| `{ kind: "blood-moon", pestBoost }` | Its turn | Mutation recipes with `event: "blood-moon"` can sprout; pests are `pestBoost` × likelier to come. |
| `{ kind: "bumper-harvest", bonus }` | The turn after | Every harvest gives +`bonus` yield. |
| `{ kind: "merchant", count, stock }` | The turn after | `count` picks from `stock` (`{ itemId, price }`) are for sale, each once. |
| `{ kind: "meteor-shower", mutationBoost, dropChance, itemId }` | Its turn | Mutation chances × `mutationBoost`; each empty tile has `dropChance` of an `itemId` landing there. |

An event can also be global: `config/farming.ts` `globalEvents` picks one a
week for everyone (a Blood Moon weekend, a Meteor Shower). A `weight` of 0
keeps an event global-only.
