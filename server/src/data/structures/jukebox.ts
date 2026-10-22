import type { Structure } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "jukebox",
    name: "Jukebox",
    icon: "musical-notes",
    description: "It only knows pest songs. They come when they hear their own.",
    stats: [{ label: "Tune", value: "Pick a pest: it's 3× likelier to be the one that comes" }],
    cost: [{ itemId: "golden-scarab", quantity: 1 }, { itemId: "beetle-shell", quantity: 4 }, { itemId: "mouse-tail", quantity: 4 }],
    effect: { kind: "jukebox", boost: 3 },
} satisfies Structure;
