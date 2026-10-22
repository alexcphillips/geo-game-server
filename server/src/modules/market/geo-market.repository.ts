import {
    GEO_ANTI_SNIPE_MS,
    GEO_MAX_ACTIVE_LISTINGS,
    geoAuctionFee,
    geoBinTax,
    geoMinBid,
    type GeoAuctionHours,
    type GeoBid,
    type GeoListingType,
    type GeoMarketListing,
    type GeoMarketResponse,
    type GeoMarketStack,
    type GeoOwnListing,
    type GeoSale,
} from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import { CONTENT, sellValueOf } from "../../content";
import { isStackable } from "../../content/content.types";
import { NEW_PET, petState } from "../../pets/pets";
import { afterCommit, withTransaction, type TxQuery } from "../../db/transaction";
import { broadcastChanged } from "../../realtime/geo-socket-hub";
import * as playerRepository from "../player/geo-player.repository";
import * as runsRepository from "../runs/geo-runs.repository";
import {
    COUNT_ACTIVE_FOR_SELLER,
    END_LISTING,
    FIND_ACTIVE_SINGLES,
    FIND_BIDS,
    FIND_CHEAPEST_STACK_LISTINGS,
    FIND_LISTING,
    FIND_OWN_LISTINGS,
    FIND_SALES,
    FIND_STACK_OFFERS,
    FIND_UNCOLLECTED_IDS,
    INSERT_BID,
    INSERT_LISTING,
    INSERT_SALE,
    FIND_ENDED_AUCTION_IDS,
    LOCK_ENDED_AUCTION,
    LOCK_LISTING,
    LOCK_SELLER,
    LOCK_STACK_LISTINGS,
    MARK_COLLECTED,
    RECORD_SALE,
    SETTLE_HELD_BID,
    SET_LEADING_BID,
    SUM_HELD_FOR_BIDDER,
} from "./geo-market.sql";
import type { BidRow, ListingRow, SaleRow, StackOfferRow } from "./geo-market.types";

/** Item ids that sell as pooled stacks rather than one listing per copy. */
const STACKABLE_IDS = Object.values(CONTENT.items)
    .filter(isStackable)
    .map((item) => item.id);

function itemName(itemId: string): string {
    return CONTENT.items[itemId]?.name ?? "that item";
}

// ---------------------------------------------------------------------------
// Views

function toListingView(row: ListingRow, viewerId: string): GeoMarketListing {
    const base = {
        id: row.id,
        item: {
            itemId: row.item_id,
            quantity: row.status === "active" ? row.quantity_left : row.quantity_listed,
            chargesLeft: row.charges_left,
            reforge: row.reforge,
            pet: petState(row.item_id, row.pet ?? NEW_PET),
            obtainedAt: row.obtained_at.toISOString(),
        },
        seller: row.seller_name,
        isMine: row.seller_id === viewerId,
        listedAt: row.created_at.toISOString(),
    };
    if (row.type === "bin") {
        return { ...base, type: "bin", price: Number(row.unit_price) * base.item.quantity };
    }
    const startingBid = Number(row.starting_bid);
    const currentBid = row.current_bid === null ? null : Number(row.current_bid);
    return {
        ...base,
        type: "auction",
        startingBid,
        currentBid,
        leadingBidder: row.leading_bidder_name,
        youLead: row.leading_bidder_id === viewerId,
        bids: row.bid_count,
        endsAt: (row.ends_at ?? row.created_at).toISOString(),
        minBid: geoMinBid(startingBid, currentBid),
    };
}

/** Once `tx` commits, everyone with the Market open reads it again. Dropped on a rollback. */
function marketChanged(tx: TxQuery) {
    afterCommit(tx, () => broadcastChanged("market"));
}

/** Everything live on the Market, as `viewerId` sees it. */
export async function findMarket(viewerId: string): Promise<GeoMarketResponse> {
    const [singles, offers, [held]] = await Promise.all([
        query<ListingRow>(FIND_ACTIVE_SINGLES, [STACKABLE_IDS]),
        query<StackOfferRow>(FIND_STACK_OFFERS, [STACKABLE_IDS, viewerId]),
        query<{ held: string }>(SUM_HELD_FOR_BIDDER, [viewerId]),
    ]);

    const stacks = new Map<string, GeoMarketStack>();
    for (const offer of offers) {
        const stack = stacks.get(offer.item_id) ?? { itemId: offer.item_id, offers: [] };
        stack.offers.push({ price: Number(offer.unit_price), quantity: Number(offer.quantity) });
        stacks.set(offer.item_id, stack);
    }

    return {
        listings: singles.map((row) => toListingView(row, viewerId)),
        stacks: [...stacks.values()],
        heldCoins: Number(held?.held ?? 0),
    };
}

/** The seller's live listings, and ended ones with coins still to collect. */
export async function findOwnListings(sellerId: string): Promise<GeoOwnListing[]> {
    const rows = await query<ListingRow>(FIND_OWN_LISTINGS, [sellerId]);
    const ids = rows.map((row) => row.id);
    const [bids, sales] = ids.length
        ? await Promise.all([query<BidRow>(FIND_BIDS, [ids]), query<SaleRow>(FIND_SALES, [ids])])
        : [[], []];

    return rows.map((row) => {
        const bidHistory: GeoBid[] = bids
            .filter((bid) => bid.listing_id === row.id)
            .map((bid) => ({ bidder: bid.bidder_name, amount: Number(bid.amount), at: bid.created_at.toISOString() }));
        const saleRows: GeoSale[] = sales
            .filter((sale) => sale.listing_id === row.id)
            .map((sale) => ({
                buyer: sale.buyer_name ?? "a former player",
                quantity: sale.quantity,
                paid: Number(sale.paid),
                at: sale.created_at.toISOString(),
            }));
        return {
            ...toListingView(row, sellerId),
            status: row.status,
            quantityListed: row.quantity_listed,
            feePaid: Number(row.fee_paid),
            bidHistory,
            sales: saleRows,
            uncollected: Number(row.proceeds) - Number(row.proceeds_collected),
        };
    });
}

// ---------------------------------------------------------------------------
// Listing

/**
 * Locks a listing and reads it fresh. Every change to a listing starts here,
 * so two buyers (or a buyer and a cancel) can never both act on one.
 */
async function lockListing(tx: TxQuery, listingId: string): Promise<ListingRow> {
    const [locked] = await tx<{ id: string }>(LOCK_LISTING, [listingId]);
    if (!locked) throw AppError.notFound("That listing is gone");
    const [row] = await tx<ListingRow>(FIND_LISTING, [listingId]);
    if (!row) throw AppError.notFound("That listing is gone");
    return row;
}

export type NewListing = {
    inventoryId: string;
    type: GeoListingType;
    quantity: number;
    /** Buy-it-now, per unit. */
    price?: number;
    startingBid?: number;
    hours?: GeoAuctionHours;
};

/**
 * Lists an item, in this order, in one transaction: the fee is paid, then the
 * item leaves the seller's inventory, and only then does the listing exist.
 * Refuses mid-Run, an item in use (worn, bagged, in a hand), a card that has
 * been played, a price under what an NPC pays, and more than
 * GEO_MAX_ACTIVE_LISTINGS at once.
 */
export async function createListing(sellerId: string, listing: NewListing): Promise<string> {
    return withTransaction(async (tx) => {
        marketChanged(tx);
        await tx(LOCK_SELLER, [sellerId]);
        await runsRepository.assertNotInRun(tx, sellerId, "You can't list items mid-Run");
        const [count] = await tx<{ count: string }>(COUNT_ACTIVE_FOR_SELLER, [sellerId]);
        if (Number(count?.count ?? 0) >= GEO_MAX_ACTIVE_LISTINGS) {
            throw AppError.badRequest(`You can have at most ${GEO_MAX_ACTIVE_LISTINGS} listings up at once`);
        }

        const [owned] = await playerRepository.findInventoryByIds(sellerId, [listing.inventoryId], tx);
        if (!owned) throw AppError.notFound("You don't own that item");
        const item = CONTENT.items[owned.item_id];
        if (!item) throw AppError.badRequest("That item can't be sold");
        if (item.soulbound) throw AppError.badRequest(`${item.name} is Soulbound: it can't be traded`);

        const stackable = isStackable(item);
        if (!stackable && listing.quantity !== 1) throw AppError.badRequest("Single items list one at a time");
        if (stackable && listing.type === "auction") throw AppError.badRequest("Stacks sell buy-it-now only");
        const fullCharge = (row: { charges_left: number | null }) =>
            item.kind !== "card" || row.charges_left === item.maxCharges;
        if (!fullCharge(owned)) throw AppError.badRequest("Only cards at full charge can be listed");

        const floor = sellValueOf(item);
        const asked = listing.type === "bin" ? listing.price : listing.startingBid;
        if (asked === undefined || asked < floor) {
            throw AppError.badRequest(
                `The lowest ${listing.type === "auction" ? "starting bid" : "price"} for ${item.name} is ${floor.toLocaleString()}${stackable ? " each" : ""}, what an NPC pays`,
            );
        }
        if (listing.type === "auction" && listing.hours === undefined) throw AppError.badRequest("Choose an auction length");

        const fee =
            listing.type === "auction"
                ? geoAuctionFee(floor, listing.hours as GeoAuctionHours)
                : geoBinTax(floor, listing.quantity);
        await playerRepository.spendCoins(tx, sellerId, fee, "market-fee", `list:${owned.item_id}`);

        const taken = await playerRepository.takeFromInventory(tx, sellerId, listing.inventoryId, listing.quantity);
        // Again on the locked row: a turn could have spent a charge since the
        // read above. Throwing here undoes the take and the fee.
        if (!fullCharge(taken)) throw AppError.badRequest("Only cards at full charge can be listed");

        const endsAt =
            listing.type === "auction" ? new Date(Date.now() + (listing.hours as number) * 3_600_000) : null;
        const [created] = await tx<{ id: string }>(INSERT_LISTING, [
            sellerId,
            listing.type,
            taken.item_id,
            stackable ? null : taken.id,
            taken.charges_left,
            taken.obtained_at,
            listing.quantity,
            listing.type === "bin" ? listing.price : null,
            listing.type === "auction" ? listing.startingBid : null,
            endsAt,
            fee,
            taken.reforge,
            taken.pet && JSON.stringify(taken.pet),
        ]);
        if (!created) throw new Error("Listing insert returned nothing");
        return created.id;
    });
}

/** Hands whatever is left in escrow back to the seller, as it was. */
async function returnToSeller(tx: TxQuery, row: ListingRow) {
    if (row.quantity_left <= 0) return;
    await playerRepository.restoreItem(tx, row.seller_id, {
        inventoryId: row.source_inventory_id,
        itemId: row.item_id,
        quantity: row.quantity_left,
        chargesLeft: row.charges_left,
        reforge: row.reforge,
        pet: row.pet,
        obtainedAt: row.obtained_at,
    });
}

/** Gives a buyer what they bought, as a new copy (charges, reforge and a pet's XP kept). */
async function deliver(tx: TxQuery, buyerId: string, row: ListingRow, quantity: number) {
    await playerRepository.grantItems(tx, buyerId, [
        { itemId: row.item_id, quantity, chargesLeft: row.charges_left ?? undefined, reforge: row.reforge, pet: row.pet },
    ]);
}

// ---------------------------------------------------------------------------
// Buying

/**
 * Buys a single item at its buy-it-now price. The buyer's coins are taken
 * first; then the item leaves escrow for their inventory and the coins wait
 * on the listing for the seller. Refused if the price isn't `expectedPrice`.
 */
export async function buyListing(buyerId: string, listingId: string, expectedPrice: number): Promise<void> {
    await withTransaction(async (tx) => {
        marketChanged(tx);
        const row = await lockListing(tx, listingId);
        if (row.status !== "active") throw AppError.badRequest("That listing has already sold or ended");
        if (row.type !== "bin") throw AppError.badRequest("That's an auction: place a bid instead");
        if (row.seller_id === buyerId) throw AppError.badRequest("You can't buy your own listing");
        if (STACKABLE_IDS.includes(row.item_id)) throw AppError.badRequest("Buy stacks from the item's offers");

        const price = Number(row.unit_price) * row.quantity_left;
        if (price !== expectedPrice) throw AppError.badRequest("The price has changed. Check it and try again.");

        await playerRepository.spendCoins(tx, buyerId, price, "market-buy", `listing:${row.id}`);
        await tx(RECORD_SALE, [row.id, row.quantity_left, price]);
        await tx(INSERT_SALE, [row.id, buyerId, row.quantity_left, price]);
        await deliver(tx, buyerId, row, row.quantity_left);
    });
}

/**
 * Buys `quantity` units of a stackable from other sellers, cheapest first,
 * across as many listings as it takes. All or nothing: refused if there
 * aren't enough, or they'd cost more than `expectedTotal`.
 */
export async function buyStack(buyerId: string, itemId: string, quantity: number, expectedTotal: number): Promise<number> {
    return withTransaction(async (tx) => {
        marketChanged(tx);
        const candidates = await tx<{ id: string }>(FIND_CHEAPEST_STACK_LISTINGS, [itemId, buyerId, quantity]);
        const locked = await tx<{ id: string; seller_id: string; unit_price: string; quantity_left: number }>(
            LOCK_STACK_LISTINGS,
            [candidates.map((row) => row.id)],
        );

        let left = quantity;
        let total = 0;
        const takes: { id: string; units: number; cost: number }[] = [];
        for (const listing of locked) {
            if (left === 0) break;
            const units = Math.min(left, listing.quantity_left);
            const cost = units * Number(listing.unit_price);
            takes.push({ id: listing.id, units, cost });
            total += cost;
            left -= units;
        }
        if (left > 0) throw AppError.badRequest(`There aren't ${quantity.toLocaleString()} ${itemName(itemId)} for sale right now`);
        if (total > expectedTotal) throw AppError.badRequest("Prices have changed. Check them and try again.");

        await playerRepository.spendCoins(tx, buyerId, total, "market-buy", `stack:${itemId}x${quantity}`);
        for (const take of takes) {
            await tx(RECORD_SALE, [take.id, take.units, take.cost]);
            await tx(INSERT_SALE, [take.id, buyerId, take.units, take.cost]);
        }
        await playerRepository.grantItems(tx, buyerId, [{ itemId, quantity }]);
        return total;
    });
}

// ---------------------------------------------------------------------------
// Bidding

/**
 * Places a bid. The bid's coins leave the bidder first — no coins, no bid —
 * then the previous leader's held coins go back to them. A bid in the last
 * 10 minutes pushes the end to 10 minutes after it, so nobody wins by
 * sniping.
 */
export async function placeBid(bidderId: string, listingId: string, amount: number): Promise<void> {
    await withTransaction(async (tx) => {
        marketChanged(tx);
        const row = await lockListing(tx, listingId);
        if (row.status !== "active" || row.type !== "auction") throw AppError.badRequest("That auction has ended");
        const endsAt = row.ends_at?.getTime() ?? 0;
        if (endsAt <= Date.now()) throw AppError.badRequest("That auction has ended");
        if (row.seller_id === bidderId) throw AppError.badRequest("You can't bid on your own auction");
        if (row.leading_bidder_id === bidderId) throw AppError.badRequest("You already have the highest bid");

        const currentBid = row.current_bid === null ? null : Number(row.current_bid);
        const minBid = geoMinBid(Number(row.starting_bid), currentBid);
        if (amount < minBid) throw AppError.badRequest(`The lowest bid now is ${minBid.toLocaleString()}`);

        await playerRepository.spendCoins(tx, bidderId, amount, "market-bid-hold", `listing:${row.id}`);

        const [outbid] = await tx<{ bidder_id: string; amount: string }>(SETTLE_HELD_BID, [row.id, "returned"]);
        if (outbid) {
            await playerRepository.addCoins(tx, outbid.bidder_id, Number(outbid.amount), "market-bid-return", `listing:${row.id}`);
        }

        await tx(INSERT_BID, [row.id, bidderId, amount]);
        const newEnd = new Date(Math.max(endsAt, Date.now() + GEO_ANTI_SNIPE_MS));
        await tx(SET_LEADING_BID, [row.id, amount, bidderId, newEnd]);
    });
}

// ---------------------------------------------------------------------------
// Ending

/**
 * The seller takes a listing down: whatever is unsold comes back to them as
 * it was. Not once an auction has a bid. The listing fee isn't refunded.
 */
export async function cancelListing(sellerId: string, listingId: string): Promise<void> {
    await withTransaction(async (tx) => {
        marketChanged(tx);
        const row = await lockListing(tx, listingId);
        if (row.seller_id !== sellerId) throw AppError.notFound("That listing is gone");
        if (row.status !== "active") throw AppError.badRequest("That listing has already ended");
        if (row.type === "auction" && row.bid_count > 0) {
            throw AppError.badRequest("An auction can't be cancelled once someone has bid");
        }
        await returnToSeller(tx, row);
        await tx(END_LISTING, [row.id, "cancelled"]);
    });
}

/**
 * An admin takes a listing down, bids or not: the leading bid goes back to its
 * bidder and the item to the seller. Coins already earned stay collectable.
 */
export async function removeListing(tx: TxQuery, listingId: string): Promise<ListingRow> {
    marketChanged(tx);
    const row = await lockListing(tx, listingId);
    if (row.status !== "active") throw AppError.badRequest("That listing has already ended");
    const [held] = await tx<{ bidder_id: string; amount: string }>(SETTLE_HELD_BID, [row.id, "returned"]);
    if (held) {
        await playerRepository.addCoins(tx, held.bidder_id, Number(held.amount), "market-bid-return", `listing:${row.id}`);
    }
    await returnToSeller(tx, row);
    await tx(END_LISTING, [row.id, "removed"]);
    return row;
}

/** Pays a listing's earned coins to its seller. Returns how many. */
async function collectOne(tx: TxQuery, sellerId: string, listingId: string): Promise<number> {
    const row = await lockListing(tx, listingId);
    if (row.seller_id !== sellerId) throw AppError.notFound("That listing is gone");
    const amount = Number(row.proceeds) - Number(row.proceeds_collected);
    if (amount <= 0) return 0;
    await tx(MARK_COLLECTED, [row.id]);
    await playerRepository.addCoins(tx, sellerId, amount, "market-collect", `listing:${row.id}`);
    return amount;
}

export async function collect(sellerId: string, listingId: string): Promise<number> {
    return withTransaction((tx) => collectOne(tx, sellerId, listingId));
}

export async function collectAll(sellerId: string): Promise<number> {
    return withTransaction(async (tx) => {
        const rows = await tx<{ id: string }>(FIND_UNCOLLECTED_IDS, [sellerId]);
        let total = 0;
        for (const { id } of rows) total += await collectOne(tx, sellerId, id);
        return total;
    });
}

/**
 * Settles one auction if its time is up: the winner gets the item and their
 * held coins go onto the listing for the seller to collect; an auction nobody
 * bid on goes back to its seller. Returns false if it wasn't settled here:
 * not ended, already settled, or being settled by someone else right now.
 */
export async function settleAuction(listingId: string): Promise<boolean> {
    return withTransaction(async (tx) => {
        const [locked] = await tx<{ id: string }>(LOCK_ENDED_AUCTION, [listingId]);
        if (!locked) return false;
        marketChanged(tx);
        const [row] = await tx<ListingRow>(FIND_LISTING, [listingId]);
        if (!row) return false;
        const [won] = await tx<{ bidder_id: string; amount: string }>(SETTLE_HELD_BID, [listingId, "won"]);
        if (won) {
            const paid = Number(won.amount);
            await tx(RECORD_SALE, [listingId, row.quantity_left, paid]);
            await tx(INSERT_SALE, [listingId, won.bidder_id, row.quantity_left, paid]);
            await deliver(tx, won.bidder_id, row, row.quantity_left);
        } else {
            await returnToSeller(tx, row);
            await tx(END_LISTING, [listingId, "expired"]);
        }
        return true;
    });
}

/**
 * Settles every auction whose time is up, each in its own transaction: one
 * that fails (say, its item left the content) is logged and left for the next
 * try, and never holds back the others or the reads that call this first.
 * Safe to run from several places at once.
 */
export async function settleEndedAuctions(): Promise<number> {
    const ended = await query<{ id: string }>(FIND_ENDED_AUCTION_IDS);
    let settled = 0;
    for (const { id } of ended) {
        try {
            if (await settleAuction(id)) settled++;
        } catch (error) {
            console.error(`geo market: settling auction ${id} failed:`, error);
        }
    }
    return settled;
}
