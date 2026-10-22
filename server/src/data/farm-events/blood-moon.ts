import type { FarmEvent } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "blood-moon",
    name: "Blood Moon",
    icon: "evil-moon",
    description: "The moon comes up red. Some things only grow under it.",
    weight: 1,
    effect: { kind: "blood-moon", pestBoost: 2 },
} satisfies FarmEvent;
