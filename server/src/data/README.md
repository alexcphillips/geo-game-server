# geo-game data

Every card, item, enemy and tuning number in the game lives here, one
TypeScript file each. The server loads this folder when it starts, checks
every file, and builds the game from it. Nothing in here needs code changes.

A file imports its model and exports the entry:

```
import type { Weapon } from "#geo/models";

// Comments are fine anywhere: notes for yourself.
export default {
    id: "claymore",
    name: "Claymore",
    ...
} satisfies Weapon;
```

`satisfies Weapon` is what makes the editor help: autocomplete for every
field, its explanation on hover, and a red underline on a mistake (a typo'd
field, a string where a number goes) as you type. The models are in
`content/models.ts`, one per folder: `Card`, `Weapon`, `Armor`, `Ring`, `Amulet`,
`Talisman`, `Material`, `Food`, `Bait`, `MiscItem`, `Fish`, `Enemy`,
`Status`, `Recipe`, `Vendor`, `Reforge`, `Mayor`, `Dungeon`, `DungeonLayout`, `RoomStyle`, `Quest`, plus a `…Config` for each file in
`config/`. Keep data files to plain values: no imports but the model, no
logic.

## The workflow

1. Add or edit a file. Copy a neighbour to start a new one.
2. While `npm run dev` is running, the server restarts by itself when a data
   file changes. A mistake stops the start and lists **every** problem, each
   with its file and field:

   ```
   geo-game data has 2 problem(s):
     cards/combat/slash.ts: maxCharges: Invalid input: expected number, received string
     Recipe "envenom" uses unknown item "spider-fangs"
   ```

3. To check your edits without starting the server, run `npm run geo:data`
   (in `server/`). `npm run typecheck` checks every file against its model.

The editor can't know whether an id you reference exists (a recipe's
`itemId`, an enemy in `config/spawns`). The server checks those when it
loads, and so does `npm run geo:data`.

## Folders

One entry per file, named by its id: `data/weapons/claymore.ts` has
`id: "claymore"`. Subfolders are only for sorting, e.g.
`cards/combat/`, `materials/mining/`.

| Folder | What | Guide |
| --- | --- | --- |
| `cards/` | Cards: their rules and the item you own, in one file | [cards](cards/README.md) |
| `weapons/` | Main-hand weapons | [weapons](weapons/README.md) |
| `armor/` | Shields (off hand), head, shoulders, chest, hands, legs, feet, cloak, belt — a subfolder per slot | [armor](armor/README.md) |
| `rings/` | Rings | [rings](rings/README.md) |
| `amulets/` | Amulets | [amulets](amulets/README.md) |
| `rods/` | Fishing rods: what a cast can hook and land | [rods](rods/README.md) |
| `talismans/` | Talismans for the Talisman Bag | [talismans](talismans/README.md) |
| `materials/` | Crafting materials, by skill | [materials](materials/README.md) |
| `food/` | Food for the lunchbox | [food](food/README.md) |
| `bait/` | Fishing bait | [bait](bait/README.md) |
| `misc/` | Keys, nets, lenses and anything else | [misc](misc/README.md) |
| `pets/` | Pets: stats while active, levelled by skill XP | [pets](pets/README.md) |
| `pet-items/` | Items a pet holds | [pet items](pet-items/README.md) |
| `fish/` | Fish that bite in a fishing Run | [fish](fish/README.md) |
| `crops/` | Crops that grow on the farm | [crops](crops/README.md) |
| `pests/` | Pests that come for the farm's crops | [pests](pests/README.md) |
| `mutations/` | Secret crops that sprout from recipes | [mutations](mutations/README.md) |
| `structures/` | Farm structures, each also an item | [structures](structures/README.md) |
| `farm-events/` | Things that happen to a farm, telegraphed a turn ahead | [farm events](farm-events/README.md) |
| `enemies/` | Enemies, their moves and their loot | [enemies](enemies/README.md) |
| `statuses/` | Burning, Frozen, Well Fed… | [statuses](statuses/README.md) |
| `recipes/` | Crafting and cooking recipes | [recipes](recipes/README.md) |
| `vendors/` | NPC shops | [vendors](vendors/README.md) |
| `reforges/` | Reforges a vendor rolls onto weapons and armor | [reforges](reforges/README.md) |
| `mayors/` | Mayors and their perks | [mayors](mayors/README.md) |
| `dungeons/` | Raid-style bosses fought from lobbies | [dungeons](dungeons/README.md) |
| `dungeon-layouts/` | Hand-drawn dungeon maps, a subfolder per dungeon | [dungeon layouts](dungeon-layouts/README.md) |
| `room-styles/` | How dungeon room outlines are drawn | [room styles](room-styles/README.md) |
| `config/` | Tuning numbers: player stats, spawns, fishing, starter kit… | [config](config/README.md) |
| `quests/` | Quests: objectives and turn-in rewards | [quests](quests/README.md) |

Rules (attacks, heals, procs, conditions) work the same everywhere they
appear: see [EFFECTS.md](EFFECTS.md).

## Ids and references

Ids use lower-case letters, digits, dots and dashes: `leather-belt`,
`fish.reel`. Files point at each other by id, and every reference is checked
when the server starts.

Some items are made for you, so they have no file of their own:

| Item id | Made from |
| --- | --- |
| `card.<id>` | each file in `cards/`, e.g. `card.fireball` |
| `compact-<id>` | a material with `"compact"`, plus its recipe |
| `fish.<id>` | each fish: the regular, tradable catch |
| `fish.<id>.<tier>` | each fish × bronze/silver/gold/ruby: Soulbound quality catches |

So a recipe that makes a Fireball card outputs `card.fireball`, and a vendor
selling Reel sells `card.fish.reel`.

## Fields every item has

Cards, weapons, armor, rings, amulets, rods, talismans, materials, food, bait and misc all
start with these:

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id` | text | yes | Unique across **all** items. Must match the file name. |
| `name` | text | yes | Shown in the app. |
| `rarity` | `common` `uncommon` `rare` `epic` `legendary` | yes | Colour, sorting, and the placeholder sell value. |
| `icon` | text | yes | A [Game Icons](https://game-icons.net) name, e.g. `broadsword`. |
| `description` | text | yes | Flavour text. |
| `stats` | list of `{ "label", "value" }` | no | Extra rows on the item page, e.g. Speed · Slow. **Words only**: nothing reads them. Stat modifiers get rows by themselves. |
| `effectText` | list of text | no | Passive effects as the app lists them. Words only: for a rule that isn't built yet, or to describe one that is. |
| `sellValue` | whole number ≥ 0 | no | Coins an NPC pays. Also the lowest Market price and the base of Market fees. Unset = the rarity placeholder in `config/economy.ts`. |

`npm run geo:sell-values` lists the items still on the placeholder.

## Removing or renaming things

Players' inventories store item ids. If you rename or delete an id that
players own, their old rows point at nothing. There are no real players yet,
so after a change like that run `npm run wipe:geo -- --yes`: it wipes
progress, keeps accounts, and re-grants the starter kit.
