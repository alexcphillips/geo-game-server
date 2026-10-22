import type { MiscItem } from "#geo/models";

// PLACEHOLDER: no rule reads nets yet.
export default {
    id: "fishing-net",
    name: "Fishing Net",
    rarity: "common",
    icon: "fishing-net",
    description: "Knotted twine. Catches more than a line, and tangles more too.",
    stats: [{ label: "Use", value: "Fishing" }],
} satisfies MiscItem;
