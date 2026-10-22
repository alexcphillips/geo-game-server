import type { Weapon } from "#geo/models";

export default {
    id: "bronze-dagger",
    name: "Bronze Dagger",
    rarity: "common",
    icon: "plain-dagger",
    description: "Soft metal, dull edge. Better than your fists, just.",
    weapon: { type: "dagger", style: "melee" },
    modifiers: [{ stat: "attack", kind: "flat", value: 2 }],
} satisfies Weapon;
