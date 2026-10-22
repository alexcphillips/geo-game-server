import type { Vendor } from "#geo/models";

export default {
    id: "angler",
    name: "Angler",
    icon: "fishing-pole",
    description: "Bait, tackle and a lot of opinions.",
    sells: [
        { itemId: "worm-bait", price: 1 },
        { itemId: "bloody-bait", price: 25 },
        { itemId: "ashwood-rod", price: 250 },
        { itemId: "greenheart-rod", price: 1500 },
        { itemId: "ironwood-rod", price: 8000 },
        { itemId: "leviathan-rod", price: 40000 },
        { itemId: "card.fish.reel", price: 40 },
        { itemId: "card.fish.slack", price: 40 },
        { itemId: "card.fish.steady", price: 40 },
        { itemId: "card.fish.hook", price: 60 },
        { itemId: "card.fish.horse", price: 60 },
        { itemId: "card.fish.gaff", price: 60 },
        { itemId: "card.fish.feather", price: 120 },
        { itemId: "card.fish.read", price: 120 },
        { itemId: "card.fish.tire", price: 120 },
        { itemId: "card.fish.twitch", price: 120 },
        { itemId: "card.fish.patient", price: 300 },
    ],
} satisfies Vendor;
