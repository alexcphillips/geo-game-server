import type { Mayor } from "#geo/models";

export default {
    id: "briar",
    name: "Briar",
    perks: [
        {
            id: "pest-control",
            name: "Pest Control",
            description: "Pests are 25% less likely to arrive on your farm.",
            icon: "bug-net",
            modifiers: [{ stat: "pestChance", kind: "percent", value: -0.25 }],
        },
        {
            id: "bountiful-fields",
            name: "Bountiful Fields",
            description: "Farming Fortune ×1.2.",
            icon: "wheat",
            modifiers: [{ stat: "farmingFortune", kind: "percent", value: 0.2 }],
        },
        {
            id: "strange-seeds",
            name: "Strange Seeds",
            description: "Mutations are 25% more likely to sprout.",
            icon: "dna1",
            modifiers: [{ stat: "mutationChance", kind: "percent", value: 0.25 }],
        },
    ],
} satisfies Mayor;
