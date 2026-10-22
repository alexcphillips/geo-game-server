# Room styles

How a dungeon room's outline is drawn. The app draws every outline from
the room's cells and these numbers, so a style works on any room shape:
1×1, 3×1, L-shaped. A dungeon sets a default `roomStyle`, a layout can
override it, and a room can pick its own `style`.

## Fields

Model: `RoomStyle` in `#geo/models` (`content/models.ts`). Hover any field in the editor for the same help.

Sizes are in map units: a cell is 64 across, with an 18-unit gap for doors.

| Field | Type | Required? | What it does |
| --- | --- | --- | --- |
| `id` | text | yes | Must match the file name. |
| `corner` | `round` / `chamfer` / `circle` | yes | Rounded corners, cut corners, or as round as the room allows (a 1×1 room becomes a circle). |
| `radius` | number ≥ 0 | no (default 8) | Corner size for `round` and `chamfer`. |
| `rough` | number ≥ 0 | no (default 0) | How jagged the walls are, for caves. 0 = straight. |
| `wall` | number > 0 | no (default 3) | Wall thickness. |
| `inset` | number ≥ 0 | no (default 4) | How far the walls sit inside the cell's edge. |
| `tone` | `stone` `moss` `ember` `bone` `void` | yes | Floor and wall colours, from a set that works in light and dark mode. |

## Example

```ts
import type { RoomStyle } from "#geo/models";

export default {
    id: "slime-pool",
    corner: "round",
    radius: 18,
    rough: 2,
    inset: 3,
    tone: "moss",
} satisfies RoomStyle;
```
