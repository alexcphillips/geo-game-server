import type { Fish } from "#geo/models";

export default {
    id: "whiskers",
    name: "Old Whiskers",
    rarity: "legendary",
    icon: "salmon",
    description: "Every angler in town has a story about the one that got away. This is it.",
    stamina: 22,
    strength: 1.5,
    distance: 12,
    moves: { run: 3, thrash: 2, dive: 3, rest: 2, jump: 1 },
    traits: ["linebreaker", "deepdiver"],
    xp: 400,
} satisfies Fish;
