import type { Structure } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "pond",
    name: "Pond",
    icon: "lily-pads",
    description: "A little water and one very hungry frog.",
    stats: [{ label: "Water and frog", value: "The 4 tiles beside it are always wet. Its frog eats 1 pest on or around it each cycle" }],
    cost: [{ itemId: "melon", quantity: 4 }, { itemId: "worm-castings", quantity: 3 }],
    effect: { kind: "pond" },
} satisfies Structure;
