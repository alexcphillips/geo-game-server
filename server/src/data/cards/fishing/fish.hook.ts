import type { Card } from "#geo/models";

export default {
    id: "fish.hook",
    name: "Set the Hook",
    rarity: "common",
    icon: "fishing-hook",
    description: "A sharp pull, so it can't shake free.",
    stats: [
        { label: "Role", value: "Control" },
        { label: "Does", value: "This turn and the next 2, it can't throw the hook or escape." },
    ],
    skill: "fishing",
    maxCharges: 10,
    targets: "self",
} satisfies Card;
