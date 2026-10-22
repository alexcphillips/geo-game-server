import type { Ring } from "#geo/models";

export default {
    id: "emerald-band",
    name: "Emerald Band",
    rarity: "uncommon",
    icon: "diamond-ring",
    description: "The stone is real. The gold, less so.",
    stats: [{ label: "Magic Power", value: "+2" }],
    effectText: ["Bazaar sell price +1%"],
} satisfies Ring;
