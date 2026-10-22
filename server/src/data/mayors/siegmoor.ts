import type { Mayor } from "#geo/models";

export default {
    id: "siegmoor",
    name: "Siegmoor",
    perks: [
        {
            id: "deep-veins",
            name: "Deep Veins",
            description: "15% chance to mine an extra ore.",
            icon: "ore",
            modifiers: [{ stat: "extraOreChance", kind: "flat", value: 0.15 }],
        },
        {
            id: "tempered-steel",
            name: "Tempered Steel",
            description: "Smithed gear gains +5% durability.",
            icon: "metal-bar",
            modifiers: [{ stat: "smithedDurability", kind: "percent", value: 0.05 }],
        },
        {
            id: "stonewall",
            name: "Stonewall",
            description: "+5% max health in Runs.",
            icon: "checked-shield",
            modifiers: [{ stat: "maxHealth", kind: "percent", value: 0.05 }],
        },
    ],
} satisfies Mayor;
