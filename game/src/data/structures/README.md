# Structures

Farm structures. They aren't items: they're built from the farm's Build list
at a farming place, which shows a structure only once the player's farming
level reaches its `requiredLevel`. Building it takes its `cost` from the
inventory then and there. Demolishing it (any tile it covers) removes it
whole and gives nothing back, so building again costs full price (a Pest
Cage must be empty first).

A structure covers one tile unless its file gives `size: { width, height }`
(each 1–9). It's centred on the tile it's placed from (an even side reaches
one further right or down), and every tile under it must be owned and clear:
no structure, waste, crop or pest. It stands on that tile; the others are
covered by it. Its
effects reach out from the tile it stands on. A Greenhouse is the exception:
it's a roof, so it can go over crops and they keep growing under it.

## Fields

Model: `Structure` in `#geo/models` (`content/models.ts`).

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | lower-case, dashes | yes | Must match the file name. |
| `name`, `icon`, `description` | text | yes | Shown in the Build list and on the farm. |
| `stats` | `{ label, value }[]` | no | Extra lines in the Build list. Words only. |
| `cost` | `{ itemId, quantity }[]` | yes | Taken from the inventory when it's built. Never refunded. |
| `requiredLevel` | 0–max skill level | no | Farming level before it shows in the Build list and can be built. Absent = 0. |
| `size` | `{ width, height }` | no | Tiles it covers (see above). Absent = 1×1. |
| `effect` | below | yes | What it does. |

## Effects

What each kind does is in the rules (`farming/farm.ts`); a file only tunes
its numbers.

| `effect` | What it does |
| --- | --- |
| `{ kind: "jukebox", boost }` | Its tune (picked on the tile, free) makes that pest `boost` times likelier to be the one that spawns. Spawn odds overall don't change. |
| `{ kind: "cage" }` | Holds one pest alive (the Cage action, free, from a tile on or next to it). A caged pest doesn't act, and counts as that pest nearby for mutation recipes. Release it to clear it for its drops. |
| `{ kind: "beehive", boost, swarmChance }` | Mutation chances × `boost` on empty tiles around it. Each turn, `swarmChance` the bees swarm and the crops around don't grow. |
| `{ kind: "compost", capacity, itemId }` | Every `capacity` harvests and clears on the farm (all count, wherever they are) make 1 `itemId` (Compost), straight into the inventory. Compost buys tiles past the first few and goes into building. |
| `{ kind: "pond" }` | The 4 tiles beside it are wet ground, and its frog eats 1 pest on or around it each turn (no drops). |
| `{ kind: "greenhouse" }` | A roof over its whole footprint. Crops grow under it with no weather (as on a clear day, safe from frost and heatwaves), no pests arrive there (they can still walk in), and no mutations sprout there. |
| `{ kind: "reactor", radius, growth, wasteChance }` | Crops within `radius` tiles grow `growth` extra stages a turn (when they grow at all). Each turn, `wasteChance` nuclear waste lands on a tile within `radius`, killing what grows there (see `config/farming.ts` `waste`). |
| `{ kind: "portal", wave, pests }` | Does nothing until a Tear the Veil card opens it. On the next turn, `wave` pests picked from `pests` come through around it, then it shuts. |
| `{ kind: "shrine" }` | Takes offerings from the inventory (on its tile, free). Their NPC value buys a roll for a blessing; see `config/farming.ts` `shrine`. |
| `{ kind: "well", radius }` | Tiles within `radius` never go dry, even in a heatwave (they count as normal ground). |
