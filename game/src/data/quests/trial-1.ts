import type { Quest } from "#geo/models";

// The gate to tier 2 enemies: they spawn only once this is turned in (and
// the player has tier 2's combat level). Kill objectives pull their enemy
// into spawns anywhere, so the crab turns up even far from water.
export default {
    id: "trial-1",
    title: "Trial I",
    after: ["fresh-off-the-fire"],
    unlocksTier: 2,
    objectives: [
        { id: "crab", type: "kill", enemy: "giant-river-crab", count: 1 },
        { id: "pits", type: "dungeon", dungeon: "slime-pits", count: 1 },
    ],
    // PLACEHOLDER: the tier is the real reward.
    rewards: { coins: 25 },
} satisfies Quest;
