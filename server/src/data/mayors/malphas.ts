import type { Mayor } from "#geo/models";

export default {
    id: "malphas",
    name: "Malphas",
    perks: [
        {
            id: "blood-pact",
            name: "Blood Pact",
            description: "+10% damage while below half health.",
            icon: "fangs",
            modifiers: [],
        },
        {
            id: "grave-robber",
            name: "Grave Robber",
            description: "+20% coins from defeated enemies.",
            icon: "skull-crossed-bones",
            modifiers: [{ stat: "coinDrops", kind: "percent", value: 0.2 }],
        },
        {
            id: "dark-bargain",
            name: "Dark Bargain",
            description: "Vendor prices are 5% lower.",
            icon: "price-tag",
            modifiers: [{ stat: "vendorPrices", kind: "percent", value: -0.05 }],
        },
    ],
} satisfies Mayor;
