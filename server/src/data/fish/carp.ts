import type { Fish } from "#geo/models";

export default {
    id: "carp",
    name: "Mirror Carp",
    rarity: "uncommon",
    icon: "salmon",
    description: "A few huge scales, like coins sewn on.",
    stamina: 6,
    strength: 1,
    distance: 6,
    moves: { run: 2, thrash: 1, dive: 4, rest: 3, jump: 0 },
    xp: 25,
} satisfies Fish;
