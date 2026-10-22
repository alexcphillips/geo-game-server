# geo-game: the game

`@geo/game` is the game itself, with no storage and no server: the combat
engine, every rule that can be worked out from data, and all content. The
Worker (`worker/`, see its README) stores players in SQLite, serves the API,
runs the clock and the socket, and imports from here; so do the smoke suites.
The API contracts the app copies are `@geo/shared` (`shared/src/`). Nothing
here does I/O, so it all runs in Node (tests, scripts) and in the Worker.

This README is also the guide to how the game behaves; where a rule needs
storage or time, it names the Worker module that does it.

```
game/src/
├── http/AppError.ts     the errors every rule throws (badRequest, notFound…); the Worker turns them into replies
├── engine/              the combat engine: pure, data-driven, seeded
│   ├── engine.types.ts  effects, triggers, conditions, actions, battle state
│   ├── battle.ts        createBattle / playCard and the event pipeline
│   ├── stats.ts         base + flat, × (1 + Σ percent)
│   ├── rng.ts           seeded RNG, resumable between turns; randomInt for unseeded picks
│   └── battle.test.ts   rules, each checked on its own
├── combat/              loadout → combatants, loot rolls
├── world/               spawn rules, travel, the stat sheet, modifier maths (gear, pet, talismans, the mayor)
├── fishing/             fishing odds with every modifier, and the rod fishing Run's rules
├── farming/             the farm's rules: cycles, crops, pests, mutations, structures, contests
├── dungeons/            dungeon maps: parse hand-drawn layouts, roll a run's map, check every roll; party vs member state
├── pets/                pet XP, levels, stats
├── data/                ALL game content, a .ts file each: cards, items, enemies, recipes, tuning (see data/README.md)
├── content/             loads data/, checks it, builds CONTENT (schemas in data.schema.ts); content-body.ts is GET /geo/content
├── modules/             rules and views that belong to one API area, beside the Worker module of the same name:
│                        camp, quests, mayor, dungeons, vendors (`*.rules.ts`), farm and fishing views, request shapes
├── lib/                 account rules (credentials.ts), request checks (validate.ts)
└── dev/                 data:index, geo:data, geo:sell-values
```

## Adding content

All content is TypeScript in `data/`, one file per card, item, enemy,
recipe…, plus tuning numbers in `data/config/`. Each file imports its model
(`import type { Weapon } from "#geo/models"`, i.e. `content/models.ts`) and
ends `satisfies Weapon`, so the editor checks it as you type.
`data/README.md` explains the layout, and each folder's README.md lists its
fields with examples. The loader (`content/data.ts`) checks every file again
against `content/data.schema.ts` (kept equal to the models by the compiler)
and lists every problem with its file. `npm run geo:data` checks the data
alone. After adding, moving or removing a data file, run `npm run data:index`
(`npm run check` fails until you do).

Combat rules are data too, built from effects (`data/EFFECTS.md`):

- **trigger**: which event, and the owner's part in it (`attacked` as
  `target` = "when you're attacked");
- **conditions**: e.g. the target `hasStatus` burning, the card `cardHasTag` fire;
- **chance**: 0–1;
- **actions**: attack, damage, heal, guard, barrier, applyStatus, removeStatus,
  cancelAction, freeCharge, modifyDamage.

The content index checks ids at boot, so a typo fails on start, not mid-fight.
If a new rule needs a trigger, condition or action that doesn't exist, add it
in `engine.types.ts` and handle it in `battle.ts`, with a test.

## Skill levels

Levels come from XP by one shared curve (`shared/src/skills.ts`), and
every skill stops at level 50; XP still counts past it. Combat level adds
1% damage dealt per level (`damageDealt`, read for every hit the player
deals, any element, procs included, never damage to oneself).

Status damage (a Burning tick) never gets `damageDealt` or any other general
buff. It changes only through a rule that asks for it: the
`damageFromStatus` condition on a `beforeDamage` effect, e.g. an Oiled
status that makes burns hit 1.5×.

## Food and the lunchbox

Food is a `consumable` item with `food` rules (`data/food/`): tags, and
actions done to the eater, e.g. a heal plus `applyStatus` Well Fed. A new dish
is an entry there; a new kind of effect is a status, built like any other.
Eating fires `foodEaten`, so gear can react to it (`foodHasTag`). Mending
never boosts the food's own heals.

Players pack food into lunchbox slots before a Run (1 slot to start, up to 4;
a stack of one food per slot, no food in two slots). Packing moves it out of
`inventory` into `lunchbox`, and unpacking moves it back, so packed
food can't be sold, listed or crafted. In a Run, `POST …/turns` with
`{ lunchboxSlot }` eats one, which takes the turn. The lunchbox can't be
repacked mid-Run.

Bait works the same way for fishing: a `consumable` with `bait` rules
(PLACEHOLDER `scent`), packed into bait slots (`bait`, 1 slot to start,
up to 4) through `PUT/DELETE /geo/me/bait/:slot`. Bait used to be cards;
the old card rows went with a progress wipe (`wipe:geo`). Each cast takes one
from the first packed slot (a mayor's Bait Lover may save it). Bait is
optional: with none packed, a cast is a bare hook that only hooks commons,
never a sea creature, and never lands a quality catch.

## Health, camp and restocking

Risk comes from not being able to top up away from camp. Health carries
between fights (`players.health`, NULL = full, clamped to max health from
gear whenever it's read): a combat Run starts from it and saves it every turn,
so closing the app mid-fight, or fleeing, keeps the damage. Fleeing costs
nothing else. A defeat (or any death) leaves a tenth of max
(`GEO_DEFEAT_HEALTH_FRACTION`) and every coin is lost. Health never
regenerates over time, and there is no resting. Only food from the packed
lunchbox refills it: as a turn in a fight, or between fights anywhere with
`POST /geo/me/lunchbox/:slot/eat`. Between fights the food resolves in the
battle engine (`eatBetweenFights`) but only its effect on health is kept:
heals and harm, which stops at 1 HP; buffs and statuses
only work in a fight. The lunchbox is the only food
a player has while away, because repacking needs camp.

Dungeon Runs are the exception: fought at full health, and the player's own
health is as it was afterwards, win or lose (`runs.keeps_health`).

Camp is set with `PUT /geo/me/camp { position }`, at most once every
`GEO_CAMP_MOVE_DAYS` (2), never expires (it stays until a new one is set), and stored rounded to 4 decimals (about 11 m), never
the exact point given. It's personal location data: only the player sees it
(never other players, admin pages or logs), and it goes with the account. `DELETE` forgets it but
keeps when it was set, so the move limit still counts. Packing the lunchbox or bait
needs `position` within `GEO_CAMP_RADIUS_METRES` of camp; unpacking works
anywhere. Rules: `modules/player/geo-camp.rules.ts`.

The bank is at camp: `POST /geo/me/bank/deposit` and `/withdraw`
`{ amount, position }` move coins between `coins` (the purse) and
`bank_coins`. Both need `position` at camp and refuse mid-Run, since a
defeat empties the purse and banking mid-fight would dodge it. Death never
touches `bank_coins`. `npm run smoke:geo-bank`.

## Wardrobe

Saved loadouts of worn gear and a pet, after SkyBlock's wardrobe
(`modules/wardrobe`, `loadouts`). A loadout points at inventory ids
rather than holding items, so a piece can be in several; whatever has left
the inventory is skipped when it's worn and left out when it's read. The
loadout last worn or saved is active (`players.active_loadout`), and every
equip and pet change saves into it. Wearing is refused mid-Run.

Rods are held in the main hand, so fishing means wearing a fishing loadout.
Auto-swap, free for everyone, wears the loadout tagged for `combat` or
`fishing` as that starts, inside the Run's own transaction and before the
gear is read: `openCombatRun` (spawns, dungeons, sea creatures),
`startFishing` and each fishing step. Fishing falls back to the first
loadout with a rod when none is tagged. `autoSwap` takes a
`LoadoutTrigger` (activity, plus enemy and dungeon for fights) and
`pickAutoLoadout` is the one place that chooses, where player-set rules
("entering this dungeon, wear X") would go. Extra slots are bought too. New
players get the starter kit's loadouts (Combat, Fishing), already tagged.
`npm run smoke:geo-wardrobe`.

## Fishing Runs

A fishing Run (`modules/fishing`, rules in `fishing/fishing-run.ts`) is a
session at one spot: it shares `runs` with combat (`kind = 'fishing'`),
so the fishing hand is locked while it's open, and only one Run of either
kind is open at a time (starting a fight leaves the spot). Each step is a
`POST /geo/fishing/:runId/actions`: cast, wait, strike, cut the line, fight
a sea creature, or play a card. Every hooked fish is fought: there's no quick land. A landed fish goes straight into the
inventory with its fishing XP, in the same transaction as the step.

A regular catch is a tradable `fish.<id>` material; a quality catch is a
Soulbound `fish.<id>.<tier>` item (made from each `data/fish/` file), which vendors and
the Market refuse. The water's tier is the app's word (the server has no map
tiles), like the player's position. PLACEHOLDER: fish, cards, tier
thresholds and the rod are first drafts; card rules are a switch on card id
until the fishing engine additions make them data. `npm run smoke:geo-fishing`
checks the whole loop.

## Dungeon runs

Starting a lobby for a dungeon with layouts rolls one map for the whole
party on the server (`dungeons/dungeon-map.ts`) and saves it whole on a
`dungeon_runs` row, so editing a layout never touches a run in
progress. That row holds the party's side (explored rooms, rooms cleared
for everyone, puzzles, deaths, the RNG); `dungeon_run_members` holds
each player's own (room, health, keys used, their loot and event rooms,
their key wings). `perspective()` merges the two for one player, and every
rule reads that. Every dungeon action settles the run to now and bumps its
`version`; the World runs one request at a time, so nothing else moves it
meanwhile.

Settling (`settle` in the repository) is where time counts:
- The boss room is the ready-up. Standing in it is being ready; once half
  of those still in are (rounded up), everyone else has 90 s to get there
  (off the clock while in a room fight) or they're out. When everyone
  still in is ready, the boss starts for all of them at once, in one
  shared fight (below). No one goes in after; dying or fleeing it is out.
- With anyone else still in, a player with no socket for 30 s lets go of
  what they hold: their room fight counts as fled, and they step back out
  of the boss room or a puzzle room.

Nobody has to act for either: the run's `dungeon:<id>` due row wakes it
at its next deadline (the World's alarm, `worker/src/jobs.ts`). The app only asks to do things (enter a room, answer a puzzle,
leave) and gets back the rooms it may see: fogged rooms and puzzle answers
never leave the server (`dungeons/dungeon-run.ts`). Every rule is checked
on each request: a door from somewhere anyone has been, nothing blocking
the way, nobody else fighting or puzzling in that room, the boss sealed
until every star room is cleared, a key in the inventory for a locked room
(one is used up).

A room fight is an ordinary combat Run (`dungeon_run_id`, `dungeon_room`),
started at the dungeon's carried health and played with the Run endpoints.
When it ends, `dungeonFightOver` tells the map: a win marks the room done
(the boss's ends the dungeon for that player, scores the party's run and
puts their chests in the Chests tab), a defeat puts that player out, a
flee goes back a room with the damage kept. The run is over once nobody is
left in it. Room fights drop their enemies' usual loot, coins and XP (so a
dungeon-only enemy can drop gear); a dungeon death never costs coins.
Eating from the lunchbox between rooms heals the dungeon's health. While a
dungeon is active, spawn fights and fishing are refused.
`npm run smoke:geo-dungeons` walks one end to end, then plays a party of
two over the socket.

## Shared fights

A dungeon's boss is one battle for the whole party (`openSharedCombatRun`
in `modules/runs`). Each player still has their own Runs row (their status,
rewards and dungeon link), grouped by `battle_id`, each holding the same
battle state; every step writes them together. `combatant_id` is the player's side of it
(`player:0`, `player:1`…), and the view shows the others as your party.

The engine takes any number of players: turn order by speed, ties to
players, then to the higher max health; a player acts only on their turn
(`actorId`); an enemy rolls its target with its move and shows it in the
intent; a player who flees `leaveBattle`s for good. Each surviving player
rolls their own boss drops.

The turn clock: GEO_RUN_TURN_SECONDS a turn, or the reconnect window for a
player with no socket (counted from when they dropped), then `skipTurn`.
`turn_deadline` is stored on the rows; the battle's `battle:<id>` due row
fires it, and a play checks it first. The
others hear every step over the socket (`run`).

## The geo socket

`GET /geo/socket` upgrades to a WebSocket (protocol in
`shared/src/realtime.contract.ts`, code in `worker/src/realtime/`). It only
pushes: players still act over HTTP, and once a change commits the World
sends each player concerned their own view: their lobby, their dungeon run,
their shared fight (`run`), or their HUD badge counts. What everyone sees
(the Market, the election) and a friends list get only a `changed` hint,
and an open screen reads again over HTTP. Each (re)connect gets fresh
snapshots, so nothing lives only in a socket. Dungeon runs and shared
fights carry a `version` the app drops older pushes by.

Presence is the socket too: a player is online while they have one, and a
last socket closing counts only after a 10 s grace, so a reconnect isn't an
offline and online. For the turn clock and dungeon holds, a signed-in HTTP
request also counts as being there. Hibernation, timers and the `gone`
table are in the Worker's README.

## Crafting

A recipe (`data/recipes/`) uses up its inputs and makes its output, per
craft, and may need skill levels (never spent). Recipes go to the app with
the content, which is how it shows an item's uses. Inputs come only from
rows that are free: nothing worn, bagged or in a hand, and cards only at full
charge.

Compact materials (`compact` in a `data/materials/` file) press `ratio`
of a material into one "Compact" item, so a recipe can want 50,000 of
something without the player carrying a 50,000 stack. That one field makes
the compact item and its recipe; it's one-way, and worth what it holds.

## Money and items

Every coin movement writes a `coin_ledger` row, so a player's coins always
equal the sum of their ledger, bank moves included as `bank-deposit` and
`bank-withdraw` (`GET /geo/admin/economy` lists any that
don't). Trades follow one order, in one transaction: coins are taken
(`spendCoins`, which refuses rather than going below 0) before anything is
handed over, and an item leaves its owner (`takeFromInventory`, refused
while worn, bagged or in a hand) before a listing or sale exists.

## Chests

An enemy with `chests` (`data/enemies/`) has a `chance` that a win gives
a chest selection in place of its loot list; coins and XP come as usual. Each
offer in it is a tier (`data/config/chest-tiers.json`: name and cost to open) with its
own chance to be in the selection, and its own loot: pools of weighted
entries, each pool rolled `rolls` times. At least one offer has chance 1 and
every chest gives at least one item; the content index refuses anything else
at boot.

Every chest is rolled at the win and saved in `chest_selections`, so
nothing rerolls. The player opens one (`POST /geo/chests/:id/open`): its cost
is spent, its items granted, and the rest are gone, their contents never
sent to the app. Until then the selection is pending, through deaths too
(`GET /geo/chests`). `assertCanOpenChests` is where a full overflow will
refuse, once the inventory has a size.

## Global effects

A mayor's perks are `StatModifier`s on any stat id. `world/modifiers.ts`
does the maths (`mayorModifiers`, `ownModifiersFrom`); the Worker's
`globalModifiers` (`modules/mayor/mayor.repository.ts`) reads the mayor in
office, and a rule reads its stat with `applyModifiers(base, modifiers,
"eelChance")` over those plus the player's own gear and talismans. Combat stats reach every
fight; `coinDrops`, `vendorPrices` and `voteWeight` are read by their rules.

## Hand-made places

Map places mostly come from the map tiles, on the phone. `places` holds
the ones an admin makes by hand (a skill hub or a landmark), which the app
draws with the same markers and the same 40 m reach
(`GEO_PLACE_REACH_METRES`). Players get the active ones within 2 km from
`GET /geo/places`, a separate call from `/geo/world` because places barely
change while spawns change every minute. Admins list, make, edit, move,
hide (`active: false`) and delete them under `/geo/admin/places`, every
change audited. Making one with a `suggestionId` links that suggestion and
accepts it; a suggestion makes at most one place. That is the only way to
accept one: agreeing with a suggestion means placing it, so `PUT` refuses
`accepted` and only rejects or reopens.

An admin can correct a suggestion before deciding (`PATCH
/geo/admin/suggestions/:id`): move its pin or change its kind. The first
move keeps the player's own pin in `original_latitude`/`original_longitude`;
the note stays the player's, and every change is audited.

## Dev servers

While the Worker's `GEO_DEV_TOOLS` is on (`wrangler dev`, the tests),
`POST /geo/runs` also takes `enemyId`, to fight anywhere; workers.dev has it
off. Every new player gets the same starter kit (`data/config/starter-kit.ts`).

The app copies `shared/src/` with `npm run sync:contracts` in the
geo-game repo; run it after changing a contract.

## Commands

From the repo root, add `--workspace @geo/game` (or run them in `game/`):

| Command | Does |
| --- | --- |
| `npm test` | engine, content, rules and spawn tests (node:test, no database) |
| `npm run data:index` | rewrites `content/data.generated.ts` after data files are added, moved or removed (`-- --check` only checks) |
| `npm run geo:data` | checks every content file |
| `npm run geo:sell-values` | which items still have a placeholder NPC sell value |

The smoke suites, `geo:admin` and `wipe:geo` run against the Worker and live
in `worker/scripts/` (see the Worker's README).
