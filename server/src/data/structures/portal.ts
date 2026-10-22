import type { Structure } from "#geo/models";

// PLACEHOLDER numbers.
export default {
    id: "portal",
    name: "Portal",
    icon: "portal",
    description: "A door that wasn't there yesterday. Something knocks back.",
    stats: [{ label: "Portal", value: "Tear the Veil opens it: 2 elite pests come through on the next cycle. Hard to clear, rich drops" }],
    cost: [{ itemId: "stardust", quantity: 2 }, { itemId: "mite-dust", quantity: 10 }, { itemId: "isotope", quantity: 2 }],
    effect: { kind: "portal", wave: 2, pests: ["rift-locust", "shade-rat"] },
} satisfies Structure;
