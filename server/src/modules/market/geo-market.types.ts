import type { GeoListingStatus, GeoListingType } from "@geo/shared";
import type { PetCopy } from "../../pets/pets";

/** A listing as pg returns it, with the names the views show. BIGINTs arrive as strings. */
export type ListingRow = {
    id: string;
    seller_id: string;
    seller_name: string;
    type: GeoListingType;
    status: GeoListingStatus;
    item_id: string;
    source_inventory_id: string | null;
    charges_left: number | null;
    reforge: string | null;
    /** Pets: the copy's XP and held item. */
    pet: PetCopy | null;
    obtained_at: Date;
    quantity_listed: number;
    quantity_left: number;
    unit_price: string | null;
    starting_bid: string | null;
    current_bid: string | null;
    leading_bidder_id: string | null;
    leading_bidder_name: string | null;
    bid_count: number;
    ends_at: Date | null;
    fee_paid: string;
    proceeds: string;
    proceeds_collected: string;
    created_at: Date;
};

export type BidRow = {
    listing_id: string;
    bidder_name: string;
    amount: string;
    created_at: Date;
};

export type SaleRow = {
    listing_id: string;
    buyer_name: string | null;
    quantity: number;
    paid: string;
    created_at: Date;
};

export type StackOfferRow = {
    item_id: string;
    unit_price: string;
    quantity: string;
};
