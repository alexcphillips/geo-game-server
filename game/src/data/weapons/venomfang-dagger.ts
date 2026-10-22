import type { Weapon } from "#geo/models";

export default {
    id: "venomfang-dagger",
    name: "Venomfang Dagger",
    rarity: "rare",
    icon: "dripping-knife",
    description: "A spider's fang on a silk-bound grip. The tip never quite dries.",
    weapon: { type: "dagger", style: "melee" },
    modifiers: [{ stat: "attack", kind: "flat", value: 6 }],
} satisfies Weapon;
