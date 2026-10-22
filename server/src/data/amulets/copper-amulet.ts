import type { Amulet } from "#geo/models";

export default {
    id: "copper-amulet",
    name: "Copper Amulet",
    rarity: "common",
    icon: "gem-pendant",
    description: "Green at the edges. It's meant to bring luck, and sometimes does.",
    modifiers: [{ stat: "critChance", kind: "flat", value: 0.03 }],
} satisfies Amulet;
