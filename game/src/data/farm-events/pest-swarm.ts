import type { FarmEvent } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "pest-swarm",
    name: "Pest Swarm",
    icon: "spotted-bug",
    description: "Something has stirred them up. More are coming.",
    weight: 2,
    effect: { kind: "pest-swarm", count: 2 },
} satisfies FarmEvent;
