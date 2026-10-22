import type { Material } from "#geo/models";

export default {
    id: "iron-ore",
    name: "Iron Ore",
    rarity: "common",
    icon: "ore",
    description: "Raw ore from an industrial yard. Smelts into iron bars.",
    skill: "mining",
} satisfies Material;
