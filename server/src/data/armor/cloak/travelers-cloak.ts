import type { Armor } from "#geo/models";

export default {
    id: "travelers-cloak",
    name: "Traveler's Cloak",
    rarity: "common",
    icon: "cape",
    description: "Wool, mud-hemmed, and older than whoever wore it last.",
    slot: "cloak",
    modifiers: [
        { stat: "defense", kind: "flat", value: 1 },
        { stat: "speed", kind: "flat", value: 1 },
    ],
} satisfies Armor;
