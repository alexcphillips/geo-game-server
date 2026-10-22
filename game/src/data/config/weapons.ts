import type { WeaponsConfig } from "#geo/models";

export default {
    types: ["dagger", "sword", "greatsword", "fists"],
    styles: ["melee"],
    // Off-hand types, e.g. shields. Off-hand armor and requiresOffHand use these.
    offHandTypes: ["shield"],
    // No weapon equipped: punch. One less attack than the Bronze Dagger.
    unarmed: { type: "fists", style: "melee", modifiers: [{ stat: "attack", kind: "flat", value: 1 }] },
} satisfies WeaponsConfig;
