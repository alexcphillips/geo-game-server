import type { Fish } from "#geo/models";

export default {
    id: "catfish",
    name: "Wels Catfish",
    rarity: "rare",
    icon: "salmon",
    description: "Whiskered, slow and enormous. It sulks on the bottom.",
    stamina: 9,
    strength: 1.2,
    distance: 8,
    moves: { run: 2, thrash: 2, dive: 4, rest: 2, jump: 0 },
    xp: 60,
} satisfies Fish;
