import type { MiscItem } from "#geo/models";

export default {
    id: "rift-lens",
    name: "Rift Lens",
    rarity: "legendary",
    icon: "portal",
    description: "Look through it and you can stand beside a friend who is far away.",
    stats: [{ label: "Use", value: "Join a friend's Run remotely" }],
    effectText: ["Joins an active walking friend's multiplayer Run from anywhere"],
} satisfies MiscItem;
