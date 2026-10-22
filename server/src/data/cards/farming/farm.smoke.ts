import type { Card } from "#geo/models";

export default {
    id: "farm.smoke",
    name: "Smoke",
    rarity: "uncommon",
    icon: "smoke-bomb",
    description: "Smoke them out. The crops won't thank you.",
    stats: [
        { label: "Role", value: "Pest control" },
        { label: "Does", value: "Clears every pest in a 3×3. Ripe crops in it lose their waiting bonus." },
    ],
    skill: "farming",
    maxCharges: 40,
    targets: "self",
} satisfies Card;
