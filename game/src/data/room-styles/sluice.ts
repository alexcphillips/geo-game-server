import type { RoomStyle } from "#geo/models";

// Cut stone: corners chipped off, set back from the cell's edge.
export default {
    id: "sluice",
    corner: "chamfer",
    radius: 9,
    inset: 6,
    tone: "void",
} satisfies RoomStyle;
