import type { MiscItem } from "#geo/models";

export default {
    id: "healing-draught",
    name: "Healing Draught",
    rarity: "uncommon",
    icon: "potion-ball",
    description: "Bitter, red, and worth it.",
    stats: [{ label: "Heals", value: "30" }],
    kind: "consumable",
} satisfies MiscItem;
