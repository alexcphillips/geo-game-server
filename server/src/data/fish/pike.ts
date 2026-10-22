import type { Fish } from "#geo/models";

export default {
    id: "pike",
    name: "Pike",
    rarity: "uncommon",
    icon: "salmon",
    description: "All teeth and bad temper. Mind your fingers.",
    stamina: 5,
    strength: 1,
    distance: 6,
    moves: { run: 4, thrash: 2, dive: 1, rest: 2, jump: 1 },
    xp: 25,
} satisfies Fish;
