import type { Fish } from "#geo/models";

export default {
    id: "musky",
    name: "Muskellunge",
    rarity: "epic",
    icon: "salmon",
    description: "The fish of ten thousand casts.",
    stamina: 14,
    strength: 1.35,
    distance: 10,
    moves: { run: 4, thrash: 3, dive: 1, rest: 2, jump: 2 },
    traits: ["slippery"],
    xp: 150,
} satisfies Fish;
