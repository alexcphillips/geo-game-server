import type { Bait } from "#geo/models";

export default {
    id: "worm-bait",
    name: "Worm Bait",
    rarity: "common",
    icon: "fishing-pole",
    description: "Raise the scent a little. Small fish can't resist it.",
    stats: [{ label: "Scent", value: "+1" }],
    sellValue: 1,
    scent: 1,
} satisfies Bait;
