import type { Fish } from "#geo/models";

export default {
    id: "trout",
    name: "Brown Trout",
    rarity: "common",
    icon: "salmon",
    description: "Speckled and quick. Loves cold, clean water.",
    stamina: 2,
    strength: 0.8,
    distance: 4,
    moves: { run: 3, thrash: 1, dive: 1, rest: 3, jump: 2 },
    xp: 10,
} satisfies Fish;
