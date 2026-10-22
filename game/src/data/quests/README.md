# Quests

Things for a player to do, and what turning them in pays. The server counts
progress and writes each objective's label for the app from it:
`Kill Green Slime (0/1)`. Only what happens while a quest is held counts,
except `camp` and `deposit`: those count what the player did before too, so
someone who placed camp or banked early isn't asked to again.

There are no quest givers to visit yet: every quest is given automatically
once the quests in its `after` are turned in (at once, for none). Turning in
works from anywhere (`POST /geo/quests/:questId/claim`).

The chain today: Slime Cull → Rainy Day Fund (camp and the bank) → Fresh off the Fire
(cooking) → Trial I.

## Trials

A Trial is a quest with `unlocksTier`: the gate-quest for an enemy tier.
Tier N enemies spawn for a player only once they have tier N's combat level
(`config/spawns.ts` `tierUnlockLevels`) **and** have turned in tier N's Trial.
Tiers open in order, so a missing Trial holds back every tier above it. A
Trial is given once the tier below it is open (and its `after` are done), so
Trial II turns up when tier 2 opens. One Trial per tier.

## Fields

Model: `Quest` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id` | text | yes | Must match the file name. |
| `title` | text | yes | Shown in the quest log and tracker. |
| `giver` | text | no | Who gives it, as the app shows it: "The Angler". |
| `after` | list of quest ids | no | Quests to turn in before this one is given. No loops. |
| `unlocksTier` | whole number, 2+ | no | Makes it the Trial for that enemy tier (see above). |
| `objectives` | list | yes | All must be met before it can be turned in. See below. |
| `rewards.coins` | whole number | no | Coins paid on turn-in. |
| `rewards.items` | list of `{ itemId, quantity }` | no | Items paid on turn-in. A quest needs coins, items or both, unless it's a Trial. |

### Objectives

Each has an `id` unique within the quest, a `count`, and a `type`:

| `type` | Field | Label | Counts |
| --- | --- | --- | --- |
| `kill` | `enemy` (enemy id) | Kill Giant River Crab | Each of that enemy defeated in a won fight, a dungeon's boss included. While unmet, that enemy also spawns anywhere for the player (`questTargetWeight` in `config/spawns.ts`), whatever its habitat or tier. |
| `dungeon` | `dungeon` (dungeon id) | Complete Slime Pits | Each win against that dungeon's boss. |
| `craft` | `recipe` (recipe id) | Cook Grilled Salmon / Craft … | Each time the recipe is made; making 3 at once counts 3. "Cook" for a cooking recipe. |
| `camp` | (`count` is 1) | Place your camp | Having ever placed a camp. |
| `deposit` | | Deposit coins in the bank | Coins put in the bank, added up over every deposit ever made. |

## Example

```ts
import type { Quest } from "#geo/models";

export default {
    id: "trial-1",
    title: "Trial I",
    after: ["fresh-off-the-fire"],
    unlocksTier: 2,
    objectives: [
        { id: "crab", type: "kill", enemy: "giant-river-crab", count: 1 },
        { id: "pits", type: "dungeon", dungeon: "slime-pits", count: 1 },
    ],
    rewards: { coins: 25 },
} satisfies Quest;
```
