import type { Fish } from "#geo/models";

export default {
    id: "perch",
    name: "Perch",
    rarity: "common",
    icon: "salmon",
    description: "Striped, spiny and everywhere. Good eating.",
    stamina: 2,
    strength: 0.7,
    distance: 4,
    moves: { run: 3, thrash: 1, dive: 1, rest: 3, jump: 1 },
    xp: 10,
} satisfies Fish;
