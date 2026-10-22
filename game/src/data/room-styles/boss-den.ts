import type { RoomStyle } from "#geo/models";

// As round as the room allows: a 1×1 room becomes a circle.
export default {
    id: "boss-den",
    corner: "circle",
    wall: 4,
    inset: 3,
    tone: "ember",
} satisfies RoomStyle;
