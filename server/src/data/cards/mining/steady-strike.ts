import type { Card } from "#geo/models";

// PLACEHOLDER: mining has no Runs yet, so this does nothing.
export default {
    id: "steady-strike",
    name: "Steady Strike",
    rarity: "common",
    icon: "mining",
    description: "A careful swing that never cracks the seam.",
    stats: [{ label: "Yield", value: "+1" }],
    skill: "mining",
    maxCharges: 200,
    targets: "self",
} satisfies Card;
