import type { Pest } from "#geo/models";

// PLACEHOLDER numbers. Like the mouse, but leaps up to 2 tiles to a crop.
export default {
    id: "hopper-beetle",
    name: "Hopper Beetle",
    icon: "flying-beetle",
    description: "Leaps across the rows and lands mouth first.",
    likes: ["wheat", "corn"],
    behaviour: { kind: "eat", reach: 2 },
    weight: 1,
    drops: [
        { itemId: "beetle-shell", chance: 1, quantity: { min: 1, max: 2 } },
        { itemId: "golden-scarab", chance: 0.03, quantity: { min: 1, max: 1 } },
    ],
    xp: 8,
    bounty: 2,
} satisfies Pest;
