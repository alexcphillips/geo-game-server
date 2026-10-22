import type { Weapon } from "#geo/models";

export default {
    id: "claymore",
    name: "Claymore",
    rarity: "common",
    icon: "broadsword",
    description:
        "A plain, heavy greatsword. Slow, but it doesn't need to be fast.",
    weapon: { type: "greatsword", style: "melee" },
    modifiers: [{ stat: "attack", kind: "flat", value: 7 }],
    unlocksCards: ["heavy-swing"],
    skills: [{ skill: "combat", level: 5 }],
} satisfies Weapon;
