import type { MiscItem } from "#geo/models";

export default {
    id: "rusty-chest-key",
    name: "Rusty Chest Key",
    rarity: "common",
    icon: "key",
    description: "Opens a common chest. Probably.",
    stats: [{ label: "Opens", value: "Common chests" }],
} satisfies MiscItem;
