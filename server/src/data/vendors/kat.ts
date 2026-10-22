import type { Vendor } from "#geo/models";

export default {
    id: "kat",
    name: "Kat",
    icon: "cat",
    description: "Leave a pet with her for a while and it comes back a cut above. She's never said how.",
    sells: [{ itemId: "silk-collar", price: 2_000, tab: "Pet Items" }],
    petUpgrades: true,
} satisfies Vendor;
