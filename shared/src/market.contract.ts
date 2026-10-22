import type { GeoPetState } from "./pet.contract";

/**
 * Market listing rules shared by the server (which enforces them) and the
 * app (which shows them before you list). Every fee is a coin sink: it leaves
 * the economy rather than going to another player.
 *
 * All fees are worked out from the item's NPC sell value (`GeoItemView.sellValue`),
 * not the asking price, and round up to at least 1 coin.
 */

/** Auction lengths a seller can pick, in hours. */
export const GEO_AUCTION_HOURS = [6, 12, 24, 48] as const;
export type GeoAuctionHours = (typeof GEO_AUCTION_HOURS)[number];

/** Share of the sell value an auction costs to list, by length. */
const AUCTION_FEE_RATE: Record<GeoAuctionHours, number> = {
    6: 0.01,
    12: 0.02,
    24: 0.03,
    48: 0.04,
};

/** Share of the sell value a buy-it-now listing costs to list, paid up front. */
export const GEO_BIN_TAX_RATE = 0.05;

function fee(base: number, rate: number): number {
    return Math.max(1, Math.ceil(base * rate));
}

/** Paid up front, from the seller's coins, when an auction is listed. */
export function geoAuctionFee(sellValue: number, hours: GeoAuctionHours): number {
    return fee(sellValue, AUCTION_FEE_RATE[hours]);
}

/**
 * Paid up front, from the seller's coins, when a buy-it-now listing goes up:
 * per listing, all units together. Nothing more is taken when it sells, so
 * the buyer pays the asking price and the seller gets all of it.
 */
export function geoBinTax(sellValue: number, quantity: number): number {
    return fee(sellValue * quantity, GEO_BIN_TAX_RATE);
}

/** How far each auction bid must beat the last: about this share of it. */
export const GEO_BID_STEP_RATE = 0.05;

/** The least any bid step may be, so cheap auctions can't be won by a coin. */
export const GEO_MIN_BID_STEP = 4;

/**
 * How much the next bid must add to `currentBid`: about 5% of it, rounded up
 * to two significant figures so steps read as round numbers (1,875 → 1,900).
 * Scales with the price, so a 500,000 bid can't be beaten by 1 coin, nor need
 * doubling. At least `GEO_MIN_BID_STEP` coins.
 */
export function geoBidStep(currentBid: number): number {
    const raw = Math.max(GEO_MIN_BID_STEP, Math.ceil(currentBid * GEO_BID_STEP_RATE));
    if (raw < 100) return raw;
    const unit = 10 ** (Math.floor(Math.log10(raw)) - 1);
    return Math.ceil(raw / unit) * unit;
}

/**
 * The least the next bid may be: the starting bid while nobody has bid, then
 * the current bid plus a step (20 → 24; 37,500 → 39,400; 500,000 → 525,000).
 *
 * Bidding holds the bid's coins on the server until the bidder is outbid
 * (then they're returned) or wins (then they go to the seller), so a winner
 * can always pay.
 */
export function geoMinBid(startingBid: number, currentBid: number | null): number {
    return currentBid === null ? startingBid : currentBid + geoBidStep(currentBid);
}

/** A bid placed with less than this left pushes the end to this long after it. */
export const GEO_ANTI_SNIPE_MS = 10 * 60_000;

/** Most listings one player may have up at once. */
export const GEO_MAX_ACTIVE_LISTINGS = 30;

/** No price, bid or total may be more than this. */
export const GEO_MAX_PRICE = 1_000_000_000;

export type GeoListingType = "auction" | "bin";

/** What a listing holds in escrow while it's up. */
export type GeoListingItem = {
    itemId: string;
    /** Units still for sale (1 for a single item). */
    quantity: number;
    /** Cards only; listed cards are always at full charge. */
    chargesLeft: number | null;
    /** Weapons and armor: the copy's reforge id, or null. It goes to the buyer with the item. */
    reforge: string | null;
    /** Pets: its level and held item, which go to the buyer with it; null for anything else. */
    pet: GeoPetState | null;
    obtainedAt: string;
};

/** A single item for sale (gear, a talisman, a card), as the Market shows it. */
export type GeoMarketListing = {
    id: string;
    item: GeoListingItem;
    /** Display name of the seller. */
    seller: string;
    isMine: boolean;
    listedAt: string;
} & (
    | {
          type: "bin";
          /** What the buyer pays. */
          price: number;
      }
    | {
          type: "auction";
          startingBid: number;
          currentBid: number | null;
          leadingBidder: string | null;
          /** Whether the viewer holds the current bid. */
          youLead: boolean;
          bids: number;
          endsAt: string;
          /** The least the next bid may be (`geoMinBid`). */
          minBid: number;
      }
);

/** Units of a stackable at one price, pooled from every seller. */
export type GeoStackOffer = {
    price: number;
    quantity: number;
};

/** One stackable on the Market: its offers, cheapest first. */
export type GeoMarketStack = {
    itemId: string;
    offers: GeoStackOffer[];
};

/** `GET /geo/market`. Other players' and your own live listings alike. */
export type GeoMarketResponse = {
    listings: GeoMarketListing[];
    /** Stacks of other players only: you can't buy your own. */
    stacks: GeoMarketStack[];
    /** Your coins held by live bids, already out of your spendable coins. */
    heldCoins: number;
};

export type GeoBid = {
    bidder: string;
    amount: number;
    at: string;
};

export type GeoSale = {
    buyer: string;
    quantity: number;
    /** Coins the buyer paid; all of it goes to the seller. */
    paid: number;
    at: string;
};

export type GeoListingStatus = "active" | "sold" | "cancelled" | "expired" | "removed";

/**
 * `GET /geo/market/mine`: your listings still up, and ended ones with coins
 * to collect. A listing leaves this list once collected (or ended with
 * nothing to collect).
 */
export type GeoOwnListing = GeoMarketListing & {
    status: GeoListingStatus;
    quantityListed: number;
    /** The fee or tax paid when it was listed. */
    feePaid: number;
    /** Auctions: every bid, oldest first. */
    bidHistory: GeoBid[];
    /** Every sale, oldest first. One for a single item; several for a stack. */
    sales: GeoSale[];
    /** Coins earned and not yet collected. */
    uncollected: number;
};

/**
 * `POST /geo/market/listings`. Replies with the player (`GeoMeResponse`).
 * - single item: `quantity` 1; `type` auction (with `startingBid`, `hours`)
 *   or bin (with `price`);
 * - stackable: `type` bin, `price` per unit, any `quantity` you own.
 */
export type GeoCreateListingRequest = {
    inventoryId: string;
    type: GeoListingType;
    quantity: number;
    /** Buy-it-now: per unit. */
    price?: number;
    /** Auction. */
    startingBid?: number;
    /** Auction. */
    hours?: GeoAuctionHours;
};

/** `POST /geo/market/listings/:listingId/buy`. Refused if the price isn't this. */
export type GeoBuyListingRequest = {
    expectedPrice: number;
};

/** `POST /geo/market/listings/:listingId/bids`. */
export type GeoBidRequest = {
    amount: number;
};

/**
 * `POST /geo/market/stacks/:itemId/buy`: `quantity` units, cheapest first.
 * Refused if they'd cost more than `expectedTotal` (prices moved).
 */
export type GeoBuyStackRequest = {
    quantity: number;
    expectedTotal: number;
};

/** What `quantity` units cost from these offers, cheapest first; null if there aren't enough. */
export function geoStackCost(offers: GeoStackOffer[], quantity: number): number | null {
    let left = quantity;
    let total = 0;
    for (const offer of offers) {
        const take = Math.min(left, offer.quantity);
        total += take * offer.price;
        left -= take;
        if (left === 0) return total;
    }
    return null;
}
