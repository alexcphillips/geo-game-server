import type { Quest } from "#geo/models";

export default {
    id: "slime-cull",
    title: "Slime Cull",
    objectives: [{ id: "kill", type: "kill", enemy: "green-slime", count: 1 }],
    rewards: { coins: 5 },
} satisfies Quest;
