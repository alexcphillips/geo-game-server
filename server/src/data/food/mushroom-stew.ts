import type { Food } from "#geo/models";

export default {
    id: "mushroom-stew",
    name: "Mushroom Stew",
    rarity: "common",
    icon: "hot-meal",
    description: "Thick and earthy. It keeps working after the bowl is empty.",
    stats: [{ label: "Then", value: "8 a turn for 3 turns" }],
    effectText: ["Well Fed: heals 8 at the start of each of your next 3 turns"],
    heal: 10,
    tags: ["hearty"],
    actions: [{ type: "applyStatus", to: "self", status: "well-fed" }],
} satisfies Food;
