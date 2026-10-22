import type { MiscItem } from "#geo/models";

export default {
    id: "gilded-chest-key",
    name: "Gilded Chest Key",
    rarity: "epic",
    icon: "skeleton-key",
    description: "Heavier than a key should be.",
    stats: [{ label: "Opens", value: "Gilded chests" }],
} satisfies MiscItem;
