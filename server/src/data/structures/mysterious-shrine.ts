import type { Structure } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "mysterious-shrine",
    name: "Mysterious Shrine",
    icon: "stone-tablet",
    description: "Old stone that wants something. It doesn't say what it gives back.",
    stats: [{ label: "Shrine", value: "Offer items: the more they're worth, the better the odds of a blessing. Sometimes it curses instead" }],
    cost: [{ itemId: "golden-scarab", quantity: 1 }, { itemId: "wheat", quantity: 20 }, { itemId: "worm-castings", quantity: 5 }],
    effect: { kind: "shrine" },
} satisfies Structure;
