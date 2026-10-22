import type { FarmEvent } from "#geo/models";

// PLACEHOLDER numbers. Global only (weight 0): see config/farming.ts globalEvents.
export default {
    id: "meteor-shower",
    name: "Meteor Shower",
    icon: "falling-star",
    description: "Stars come down all night. Strange things grow where they land.",
    weight: 0,
    effect: { kind: "meteor-shower", mutationBoost: 2, dropChance: 0.04, itemId: "stardust" },
} satisfies FarmEvent;
