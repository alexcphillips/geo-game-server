import type { Material } from "#geo/models";

export default {
    id: "emberwheat",
    name: "Emberwheat Sheaf",
    rarity: "rare",
    icon: "flamed-leaf",
    description: "Wheat that came through a heatwave still smouldering.",
    stats: [{ label: "From", value: "A mutation" }],
    sellValue: 60,
    skill: "farming",
} satisfies Material;
