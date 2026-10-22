import type { Armor } from "#geo/models";

// PLACEHOLDER numbers, until a balance pass.
export default {
    id: "harvest-gloves",
    name: "Harvest Gloves",
    rarity: "rare",
    icon: "gauntlet",
    description: "Stained green to the wrist. Nothing slips through them.",
    slot: "hands",
    modifiers: [{ stat: "farmingFortune", kind: "flat", value: 25 }],
} satisfies Armor;
