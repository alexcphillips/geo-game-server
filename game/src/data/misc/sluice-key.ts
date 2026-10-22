import type { MiscItem } from "#geo/models";

// PLACEHOLDER: a stand-in for testing locked wings. Keys with finite uses
// (Tarkov-style) aren't built yet; this is an ordinary item for now.
export default {
    id: "sluice-key",
    name: "Sluice Key",
    rarity: "uncommon",
    icon: "key",
    description: "Opens the Sluice Gate in the Slime Pits.",
    stats: [{ label: "Opens", value: "Sluice Gate (Slime Pits)" }],
} satisfies MiscItem;
