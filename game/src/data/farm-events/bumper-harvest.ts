import type { FarmEvent } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "bumper-harvest",
    name: "Bumper Harvest",
    icon: "wheat",
    description: "Everything's heavier than it looks this cycle.",
    weight: 2,
    effect: { kind: "bumper-harvest", bonus: 1 },
} satisfies FarmEvent;
