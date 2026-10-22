import type { Card } from "#geo/models";

export default {
    id: "farm.hazmat-scrub",
    name: "Hazmat Scrub",
    rarity: "common",
    icon: "gas-mask",
    description: "Gloves, mask, bucket. Don't ask what's in the bucket.",
    stats: [
        { label: "Role", value: "Atomic" },
        { label: "Does", value: "Scrubs the nuclear waste off one tile." },
    ],
    skill: "farming",
    maxCharges: 40,
    targets: "self",
} satisfies Card;
