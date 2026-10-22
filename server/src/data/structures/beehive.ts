import type { Structure } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "beehive",
    name: "Beehive",
    icon: "beehive",
    description: "Busy bees carry pollen further than you would.",
    stats: [{ label: "Bees", value: "Mutation odds ×1.5 on the tiles around. 5% a cycle they swarm and the crops around don't grow" }],
    cost: [{ itemId: "wheat", quantity: 15 }, { itemId: "mite-dust", quantity: 5 }],
    effect: { kind: "beehive", boost: 1.5, swarmChance: 0.05 },
} satisfies Structure;
