import type { Material } from "#geo/models";

export default {
    id: "stardust",
    name: "Stardust",
    rarity: "rare",
    icon: "sparkles",
    description: "Still faintly warm. It fell on your farm during a Meteor Shower.",
    stats: [{ label: "From", value: "Meteor Showers" }],
    sellValue: 50,
    skill: "farming",
} satisfies Material;
