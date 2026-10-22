import type { Mayor } from "#geo/models";

export default {
    id: "luna",
    name: "Luna",
    perks: [
        {
            id: "moonlit-harvest",
            name: "Moonlit Harvest",
            description: "Crops grow 15% faster at night.",
            icon: "moon",
            modifiers: [{ stat: "nightCropGrowth", kind: "percent", value: 0.15 }],
        },
        {
            id: "forager-s-luck",
            name: "Forager's Luck",
            description: "+10% rare forage chance.",
            icon: "clover",
            modifiers: [{ stat: "rareForageChance", kind: "percent", value: 0.1 }],
        },
        {
            id: "starlight-focus",
            name: "Starlight Focus",
            description: "Start each Run with +1 focus.",
            icon: "crystal-ball",
            modifiers: [{ stat: "startingFocus", kind: "flat", value: 1 }],
        },
    ],
} satisfies Mayor;
