import type { Material } from "#geo/models";

export default {
    id: "silk-spool",
    name: "Silk Spool",
    rarity: "uncommon",
    icon: "sewing-string",
    description: "Spider silk, wound tight. Stronger than it looks.",
    sellValue: 6,
    skill: "combat",
    compact: { ratio: 100 },
} satisfies Material;
