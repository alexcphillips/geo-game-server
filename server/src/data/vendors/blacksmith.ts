import type { Vendor } from "#geo/models";

export default {
    id: "blacksmith",
    name: "Blacksmith",
    icon: "anvil",
    description: "Plain, honest steel for anyone heading out. For a price she'll rework what you've got.",
    sells: [
        { itemId: "bronze-dagger", price: 50, tab: "Weapons" },
        { itemId: "card.slash", price: 40, tab: "Cards" },
        { itemId: "card.double-slash", price: 40, tab: "Cards" },
        { itemId: "card.barrier", price: 60, tab: "Cards" },
    ],
    // Coins per reroll, by the item's rarity.
    reforge: { cost: { common: 100, uncommon: 250, rare: 1000, epic: 4000, legendary: 15000 } },
} satisfies Vendor;
