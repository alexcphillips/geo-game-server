import type { Fish } from "#geo/models";

export default {
    id: "sturgeon",
    name: "Sturgeon",
    rarity: "rare",
    icon: "salmon",
    description: "Armored in bony plates. Older than it looks.",
    stamina: 10,
    strength: 1.15,
    distance: 8,
    moves: { run: 3, thrash: 1, dive: 2, rest: 2, jump: 2 },
    xp: 60,
} satisfies Fish;
