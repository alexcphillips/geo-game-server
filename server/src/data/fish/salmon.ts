import type { Fish } from "#geo/models";

export default {
    id: "salmon",
    name: "Salmon",
    rarity: "common",
    icon: "salmon",
    description: "Pink-fleshed and strong-willed. It always wants upstream.",
    stamina: 3,
    strength: 0.9,
    distance: 5,
    moves: { run: 4, thrash: 1, dive: 1, rest: 2, jump: 2 },
    xp: 10,
} satisfies Fish;
