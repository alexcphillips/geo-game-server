import type { GeoRarity } from "./content.contract";

/**
 * NPC vendors. Each sells a fixed list, and every vendor buys any item with a
 * sell value above 0 that isn't Soulbound, at that sell value
 * (`GeoItemView.sellValue`) — the same number that is the item's lowest
 * Market price.
 */

export type GeoVendorOffer = {
    itemId: string;
    /** Coins per unit. */
    price: number;
    /** Units left; null is unlimited. */
    stock: number | null;
    /** The buy tab it's listed under, e.g. "Weapons"; unset = "Buy". */
    tab?: string;
};

export type GeoVendor = {
    id: string;
    name: string;
    /** A Game Icons name. */
    icon: string;
    description: string;
    /** What the player can buy here. */
    sells: GeoVendorOffer[];
    /**
     * Set when the vendor reforges: coins per reroll, by the item's rarity
     * (mayor perks included). A reroll never lands on the reforge it has.
     */
    reforgeCost?: Record<GeoRarity, number>;
    /** Set when the vendor raises pets' rarity (Kat). Each pet's price is on its `GeoPetState.upgrade`. */
    petUpgrades?: boolean;
};

/** `GET /geo/vendors`. */
export type GeoVendorsResponse = {
    vendors: GeoVendor[];
};

/** `POST /geo/vendors/:vendorId/buy`. Replies with the player (`GeoMeResponse`). */
export type GeoVendorBuyRequest = {
    itemId: string;
    quantity: number;
};

/** `POST /geo/vendors/:vendorId/sell`. Replies with the player (`GeoMeResponse`). */
export type GeoVendorSellRequest = {
    inventoryId: string;
    quantity: number;
};

/** `POST /geo/vendors/:vendorId/reforge`. Replies with the player (`GeoMeResponse`); the copy keeps its id. */
export type GeoVendorReforgeRequest = {
    inventoryId: string;
};

/** Most units one buy or sell may move. */
export const GEO_VENDOR_MAX_QUANTITY = 999;
