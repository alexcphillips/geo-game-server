import type { GeoListingStatus, GeoListingType } from "@geo/shared";

/** A listing as SQLite returns it, with the names the views show. `pet`: JSON, a pet copy's XP and held item. */
export type ListingRecord = {
    id: string;
    seller_id: string;
    seller_name: string;
    type: GeoListingType;
    status: GeoListingStatus;
    item_id: string;
    source_inventory_id: string | null;
    charges_left: number | null;
    reforge: string | null;
    pet: string | null;
    obtained_at: number;
    quantity_listed: number;
    quantity_left: number;
    unit_price: number | null;
    starting_bid: number | null;
    current_bid: number | null;
    leading_bidder_id: string | null;
    leading_bidder_name: string | null;
    bid_count: number;
    ends_at: number | null;
    fee_paid: number;
    proceeds: number;
    proceeds_collected: number;
    created_at: number;
};

export type BidRecord = { listing_id: string; bidder_name: string; amount: number; created_at: number };

export type SaleRecord = { listing_id: string; buyer_name: string | null; quantity: number; paid: number; created_at: number };

export type StackOfferRecord = { item_id: string; unit_price: number; quantity: number };

export type StackListingRecord = { id: string; seller_id: string; unit_price: number; quantity_left: number };
