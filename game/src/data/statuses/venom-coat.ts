import type { Status } from "#geo/models";

// From Envenom. Every hit, Double Slash's two included, poisons the target.
export default {
    id: "venom-coat",
    name: "Venom Coat",
    maxStacks: 1,
    effects: [
        {
            id: "venom-coat.poison",
            trigger: { event: "attacked", as: "actor" },
            actions: [{ type: "applyStatus", to: "target", status: "poisoned" }],
        },
    ],
} satisfies Status;
