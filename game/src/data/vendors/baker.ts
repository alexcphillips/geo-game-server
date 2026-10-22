import type { Vendor } from "#geo/models";

export default {
    id: "baker",
    name: "Baker",
    icon: "sliced-bread",
    description:
        "Bread for the road. Pack some before you go looking for trouble.",
    sells: [{ itemId: "bread", price: 3 }],
} satisfies Vendor;
