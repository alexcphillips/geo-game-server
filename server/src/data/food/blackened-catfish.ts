import type { Food } from "#geo/models";

export default {
    id: "blackened-catfish",
    name: "Blackened Catfish",
    rarity: "rare",
    icon: "fried-fish",
    description: "Crusted in char and spice. It keeps you going.",
    stats: [{ label: "Then", value: "8 a turn for 3 turns" }],
    effectText: ["Well Fed: heals 8 at the start of each of your next 3 turns"],
    heal: 70,
    tags: ["fish"],
    actions: [{ type: "applyStatus", to: "self", status: "well-fed" }],
} satisfies Food;
