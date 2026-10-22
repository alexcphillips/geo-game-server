import type { Food } from "#geo/models";

export default {
    id: "bread",
    name: "Bread",
    rarity: "common",
    icon: "sliced-bread",
    description: "A plain loaf. It fills a gap.",
    sellValue: 1,
    heal: 15,
} satisfies Food;
