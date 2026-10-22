import type { Material } from "#geo/models";

export default {
    id: "isotope",
    name: "Isotope",
    rarity: "rare",
    icon: "radioactive",
    description: "It glows through your pocket. A Glow Beetle carried it out of the waste.",
    stats: [{ label: "From", value: "Glow Beetles" }],
    sellValue: 45,
    skill: "farming",
} satisfies Material;
