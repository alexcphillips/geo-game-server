import type { StarterKitConfig } from "#geo/models";

export default {
    items: [
        { itemId: "bronze-dagger", quantity: 1 },
        { itemId: "twig-rod", quantity: 1 },
        { itemId: "card.slash", quantity: 1 },
        { itemId: "card.double-slash", quantity: 1 },
        { itemId: "card.fish.reel", quantity: 1 },
        { itemId: "card.fish.slack", quantity: 1 },
        { itemId: "card.fish.tire", quantity: 1 },
        { itemId: "card.fish.gaff", quantity: 1 },
        { itemId: "card.farm.hold", quantity: 1 },
        { itemId: "card.farm.swat", quantity: 1 },
        { itemId: "card.farm.hand-pollinate", quantity: 1 },
        { itemId: "card.farm.read-sky", quantity: 1 },
        { itemId: "card.farm.smoke", quantity: 1 },
        { itemId: "wheat-seeds", quantity: 12 },
        { itemId: "carrot-seeds", quantity: 6 },
    ],
    // A loadout to fight in and one to fish in, tagged for auto-swap; the first is worn.
    loadouts: [
        { name: "Combat", autoFor: "combat", equip: { mainHand: "bronze-dagger" } },
        { name: "Fishing", autoFor: "fishing", equip: { mainHand: "twig-rod" } },
    ],
    handSkills: ["combat", "fishing", "farming"],
    lunchbox: [{ itemId: "bread", quantity: 5 }],
    bait: [{ itemId: "worm-bait", quantity: 20 }],
} satisfies StarterKitConfig;
