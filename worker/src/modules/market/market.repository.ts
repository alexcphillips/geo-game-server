import {
    GEO_ANTI_SNIPE_MS,
    GEO_MAX_ACTIVE_LISTINGS,
    geoAuctionFee,
    geoBinTax,
    geoMinBid,
    type GeoAuctionHours,
    type GeoBid,
    type GeoMarketListing,
    type GeoMarketResponse,
    type GeoMarketStack,
    type GeoOwnListing,
    type GeoSale,
} from "@geo/shared";
import { CONTENT, sellValueOf } from "../../../../server/src/content";
import { isStackable } from "../../../../server/src/content/content.types";
import { AppError } from "../../../../server/src/http/AppError";
import type { NewListing } from "../../../../server/src/modules/market/geo-market.repository";
import { NEW_PET, petState, type PetCopy } from "../../../../server/src/pets/pets";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import { schedule } from "../jobs/jobs.repository";
import * as playerRepository from "../player/player.repository";
import { assertNotInRun } from "../runs/runs.repository";
import {
    COUNT_ACTIVE_FOR_SELLER,
    END_LISTING,
    FIND_ACTIVE_SINGLES,
    FIND_BIDS,
    FIND_CHEAPEST_STACK_LISTINGS,
    FIND_ENDED_AUCTION_IDS,
    FIND_LISTING,
    FIND_OWN_LISTINGS,
    FIND_SALES,
    FIND_STACK_OFFERS,
    FIND_UNCOLLECTED_IDS,
    INSERT_BID,
    INSERT_LISTING,
    INSERT_SALE,
    MARK_COLLECTED,
    RECORD_SALE,
    SETTLE_HELD_BID,
    SET_LEADING_BID,
    SUM_HELD_FOR_BIDDER,
} from "./market.sql.ts";
import type { BidRecord, ListingRecord, SaleRecord, StackListingRecord, StackOfferRecord } from "./market.types";

/**
 * The Market, from server/src/modules/market/geo-market.repository.ts. One
 * World runs one request at a time, so a listing read inside a transaction
 * is as good as a locked one. An auction's end is its `auction:<id>` row of
 * the `due` table (moved by an anti-snipe bid): the alarm settles it on time,
 * and reads settle any the alarm hasn't reached yet.
 */

/** Item ids that sell as pooled stacks rather than one listing per copy. */
const STACKABLE_IDS = Object.values(CONTENT.items)
    .filter(isStackable)
    .map((item) => item.id);
const STACKABLE_JSON = JSON.stringify(STACKABLE_IDS);

const iso = (ms: number) => new Date(ms).toISOString();
const itemName = (itemId: string) => CONTENT.items[itemId]?.name ?? "that item";
const petOfRow = (row: ListingRecord) => (row.pet === null ? null : (JSON.parse(row.pet) as PetCopy));
const auctionKey = (listingId: string) => `auction:${listingId}`;

// ---------------------------------------------------------------------------
// Views

function toListingView(row: ListingRecord, viewerId: string): GeoMarketListing {
    const base = {
        id: row.id,
        item: {
            itemId: row.item_id,
            quantity: row.status === "active" ? row.quantity_left : row.quantity_listed,
            chargesLeft: row.charges_left,
            reforge: row.reforge,
            pet: petState(row.item_id, petOfRow(row) ?? NEW_PET),
            obtainedAt: iso(row.obtained_at),
        },
        seller: row.seller_name,
        isMine: row.seller_id === viewerId,
        listedAt: iso(row.created_at),
    };
    if (row.type === "bin") return { ...base, type: "bin", price: (row.unit_price ?? 0) * base.item.quantity };
    const startingBid = row.starting_bid ?? 0;
    return {
        ...base,
        type: "auction",
        startingBid,
        currentBid: row.current_bid,
        leadingBidder: row.leading_bidder_name,
        youLead: row.leading_bidder_id === viewerId,
        bids: row.bid_count,
        endsAt: iso(row.ends_at ?? row.created_at),
        minBid: geoMinBid(startingBid, row.current_bid),
    };
}

/** Once the caller's transaction commits, everyone with the Market open reads it again. */
function marketChanged(world: World) {
    world.db.afterCommit(() => world.hub.broadcastChanged("market"));
}

/** Everything live on the Market, as `viewerId` sees it. Settles ended auctions first, so it may write. */
export function findMarket(world: World, viewerId: string): GeoMarketResponse {
    const { db } = world;
    settleEndedAuctions(world);
    const stacks = new Map<string, GeoMarketStack>();
    for (const offer of db.all<StackOfferRecord>(FIND_STACK_OFFERS, STACKABLE_JSON, viewerId)) {
        const stack = stacks.get(offer.item_id) ?? { itemId: offer.item_id, offers: [] };
        stack.offers.push({ price: offer.unit_price, quantity: offer.quantity });
        stacks.set(offer.item_id, stack);
    }
    return {
        listings: db.all<ListingRecord>(FIND_ACTIVE_SINGLES).map((row) => toListingView(row, viewerId)),
        stacks: [...stacks.values()],
        heldCoins: db.one<{ held: number }>(SUM_HELD_FOR_BIDDER, viewerId)?.held ?? 0,
    };
}

/** The seller's live listings, and ended ones with coins still to collect. Settles ended auctions first. */
export function findOwnListings(world: World, sellerId: string): GeoOwnListing[] {
    const { db } = world;
    settleEndedAuctions(world);
    const rows = db.all<ListingRecord>(FIND_OWN_LISTINGS, sellerId);
    const ids = JSON.stringify(rows.map((row) => row.id));
    const bids = rows.length ? db.all<BidRecord>(FIND_BIDS, ids) : [];
    const sales = rows.length ? db.all<SaleRecord>(FIND_SALES, ids) : [];

    return rows.map((row) => {
        const bidHistory: GeoBid[] = bids
            .filter((bid) => bid.listing_id === row.id)
            .map((bid) => ({ bidder: bid.bidder_name, amount: bid.amount, at: iso(bid.created_at) }));
        const saleRows: GeoSale[] = sales
            .filter((sale) => sale.listing_id === row.id)
            .map((sale) => ({ buyer: sale.buyer_name ?? "a former player", quantity: sale.quantity, paid: sale.paid, at: iso(sale.created_at) }));
        return {
            ...toListingView(row, sellerId),
            status: row.status,
            quantityListed: row.quantity_listed,
            feePaid: row.fee_paid,
            bidHistory,
            sales: saleRows,
            uncollected: row.proceeds - row.proceeds_collected,
        };
    });
}

// ---------------------------------------------------------------------------
// Listing

function findListing(db: Db, listingId: string): ListingRecord {
    const row = db.one<ListingRecord>(FIND_LISTING, listingId);
    if (!row) throw AppError.notFound("That listing is gone");
    return row;
}

/**
 * Lists an item, in this order: the fee is paid, then the item leaves the
 * seller's inventory, and only then does the listing exist. Refuses mid-Run,
 * an item in use (worn, bagged, in a hand), a card that has been played, a
 * price under what an NPC pays, and more than GEO_MAX_ACTIVE_LISTINGS at once.
 */
export function createListing(world: World, sellerId: string, listing: NewListing): string {
    const { db } = world;
    assertNotInRun(db, sellerId, "You can't list items mid-Run");
    if ((db.one<{ count: number }>(COUNT_ACTIVE_FOR_SELLER, sellerId)?.count ?? 0) >= GEO_MAX_ACTIVE_LISTINGS) {
        throw AppError.badRequest(`You can have at most ${GEO_MAX_ACTIVE_LISTINGS} listings up at once`);
    }

    const owned = playerRepository.findInventoryRow(db, sellerId, listing.inventoryId);
    if (!owned) throw AppError.notFound("You don't own that item");
    const item = CONTENT.items[owned.item_id];
    if (!item) throw AppError.badRequest("That item can't be sold");
    if (item.soulbound) throw AppError.badRequest(`${item.name} is Soulbound: it can't be traded`);

    const stackable = isStackable(item);
    if (!stackable && listing.quantity !== 1) throw AppError.badRequest("Single items list one at a time");
    if (stackable && listing.type === "auction") throw AppError.badRequest("Stacks sell buy-it-now only");
    if (item.kind === "card" && owned.charges_left !== item.maxCharges) throw AppError.badRequest("Only cards at full charge can be listed");

    const floor = sellValueOf(item);
    const asked = listing.type === "bin" ? listing.price : listing.startingBid;
    if (asked === undefined || asked < floor) {
        throw AppError.badRequest(
            `The lowest ${listing.type === "auction" ? "starting bid" : "price"} for ${item.name} is ${floor.toLocaleString()}${stackable ? " each" : ""}, what an NPC pays`,
        );
    }
    if (listing.type === "auction" && listing.hours === undefined) throw AppError.badRequest("Choose an auction length");

    const fee = listing.type === "auction" ? geoAuctionFee(floor, listing.hours as GeoAuctionHours) : geoBinTax(floor, listing.quantity);
    playerRepository.spendCoins(db, sellerId, fee, "market-fee", `list:${owned.item_id}`);
    const taken = playerRepository.takeFromInventory(db, sellerId, listing.inventoryId, listing.quantity);

    const id = crypto.randomUUID();
    const now = Date.now();
    const endsAt = listing.type === "auction" ? now + (listing.hours as number) * 3_600_000 : null;
    db.run(
        INSERT_LISTING,
        id,
        sellerId,
        listing.type,
        taken.item_id,
        stackable ? null : taken.id,
        taken.charges_left,
        taken.obtained_at,
        listing.quantity,
        listing.type === "bin" ? (listing.price ?? null) : null,
        listing.type === "auction" ? (listing.startingBid ?? null) : null,
        endsAt,
        fee,
        taken.reforge,
        taken.pet && JSON.stringify(taken.pet),
        now,
    );
    if (endsAt !== null) schedule(db, auctionKey(id), endsAt);
    marketChanged(world);
    return id;
}

/** Hands whatever is left in escrow back to the seller, as it was. */
function returnToSeller(db: Db, row: ListingRecord) {
    if (row.quantity_left <= 0) return;
    playerRepository.restoreItem(db, row.seller_id, {
        inventoryId: row.source_inventory_id,
        itemId: row.item_id,
        quantity: row.quantity_left,
        chargesLeft: row.charges_left,
        reforge: row.reforge,
        pet: petOfRow(row),
        obtainedAt: row.obtained_at,
    });
}

/** Gives a buyer what they bought, as a new copy (charges, reforge and a pet's XP kept). */
function deliver(db: Db, buyerId: string, row: ListingRecord, quantity: number) {
    playerRepository.grantItems(db, buyerId, [
        { itemId: row.item_id, quantity, chargesLeft: row.charges_left ?? undefined, reforge: row.reforge, pet: petOfRow(row) },
    ]);
}

function recordSale(db: Db, listingId: string, buyerId: string, quantity: number, paid: number) {
    const now = Date.now();
    db.run(RECORD_SALE, listingId, quantity, paid, now);
    db.run(INSERT_SALE, listingId, buyerId, quantity, paid, now);
}

// ---------------------------------------------------------------------------
// Buying

/**
 * Buys a single item at its buy-it-now price. The buyer's coins are taken
 * first; then the item leaves escrow for their inventory and the coins wait
 * on the listing for the seller. Refused if the price isn't `expectedPrice`.
 */
export function buyListing(world: World, buyerId: string, listingId: string, expectedPrice: number) {
    const { db } = world;
    const row = findListing(db, listingId);
    if (row.status !== "active") throw AppError.badRequest("That listing has already sold or ended");
    if (row.type !== "bin") throw AppError.badRequest("That's an auction: place a bid instead");
    if (row.seller_id === buyerId) throw AppError.badRequest("You can't buy your own listing");
    if (STACKABLE_IDS.includes(row.item_id)) throw AppError.badRequest("Buy stacks from the item's offers");

    const price = (row.unit_price ?? 0) * row.quantity_left;
    if (price !== expectedPrice) throw AppError.badRequest("The price has changed. Check it and try again.");

    playerRepository.spendCoins(db, buyerId, price, "market-buy", `listing:${row.id}`);
    recordSale(db, row.id, buyerId, row.quantity_left, price);
    deliver(db, buyerId, row, row.quantity_left);
    marketChanged(world);
}

/**
 * Buys `quantity` units of a stackable from other sellers, cheapest first,
 * across as many listings as it takes. All or nothing: refused if there
 * aren't enough, or they'd cost more than `expectedTotal`.
 */
export function buyStack(world: World, buyerId: string, itemId: string, quantity: number, expectedTotal: number): number {
    const { db } = world;
    let left = quantity;
    let total = 0;
    const takes: { id: string; units: number; cost: number }[] = [];
    for (const listing of db.all<StackListingRecord>(FIND_CHEAPEST_STACK_LISTINGS, itemId, buyerId, quantity)) {
        if (left === 0) break;
        const units = Math.min(left, listing.quantity_left);
        const cost = units * listing.unit_price;
        takes.push({ id: listing.id, units, cost });
        total += cost;
        left -= units;
    }
    if (left > 0) throw AppError.badRequest(`There aren't ${quantity.toLocaleString()} ${itemName(itemId)} for sale right now`);
    if (total > expectedTotal) throw AppError.badRequest("Prices have changed. Check them and try again.");

    playerRepository.spendCoins(db, buyerId, total, "market-buy", `stack:${itemId}x${quantity}`);
    for (const take of takes) recordSale(db, take.id, buyerId, take.units, take.cost);
    playerRepository.grantItems(db, buyerId, [{ itemId, quantity }]);
    marketChanged(world);
    return total;
}

// ---------------------------------------------------------------------------
// Bidding

/** Gives the held bid on a listing back to its bidder, if there is one. */
function returnHeldBid(db: Db, listingId: string) {
    const held = db.one<{ bidder_id: string; amount: number }>(SETTLE_HELD_BID, listingId, "returned");
    if (held) playerRepository.addCoins(db, held.bidder_id, held.amount, "market-bid-return", `listing:${listingId}`);
}

/**
 * Places a bid. The bid's coins leave the bidder first (no coins, no bid),
 * then the previous leader's held coins go back to them. A bid in the last
 * 10 minutes pushes the end to 10 minutes after it, so nobody wins by
 * sniping.
 */
export function placeBid(world: World, bidderId: string, listingId: string, amount: number) {
    const { db } = world;
    const now = Date.now();
    settleAuction(world, listingId, now);
    const row = findListing(db, listingId);
    if (row.status !== "active" || row.type !== "auction") throw AppError.badRequest("That auction has ended");
    const endsAt = row.ends_at ?? 0;
    if (row.seller_id === bidderId) throw AppError.badRequest("You can't bid on your own auction");
    if (row.leading_bidder_id === bidderId) throw AppError.badRequest("You already have the highest bid");

    const minBid = geoMinBid(row.starting_bid ?? 0, row.current_bid);
    if (amount < minBid) throw AppError.badRequest(`The lowest bid now is ${minBid.toLocaleString()}`);

    playerRepository.spendCoins(db, bidderId, amount, "market-bid-hold", `listing:${row.id}`);
    returnHeldBid(db, row.id);
    db.run(INSERT_BID, row.id, bidderId, amount, now);
    const newEnd = Math.max(endsAt, now + GEO_ANTI_SNIPE_MS);
    db.run(SET_LEADING_BID, row.id, amount, bidderId, newEnd);
    if (newEnd !== endsAt) schedule(db, auctionKey(row.id), newEnd);
    marketChanged(world);
}

// ---------------------------------------------------------------------------
// Ending

/**
 * The seller takes a listing down: whatever is unsold comes back to them as
 * it was. Not once an auction has a bid. The listing fee isn't refunded.
 */
export function cancelListing(world: World, sellerId: string, listingId: string) {
    const { db } = world;
    settleAuction(world, listingId);
    const row = findListing(db, listingId);
    if (row.seller_id !== sellerId) throw AppError.notFound("That listing is gone");
    if (row.status !== "active") throw AppError.badRequest("That listing has already ended");
    if (row.type === "auction" && row.bid_count > 0) throw AppError.badRequest("An auction can't be cancelled once someone has bid");
    returnToSeller(db, row);
    db.run(END_LISTING, row.id, "cancelled", Date.now());
    if (row.type === "auction") schedule(db, auctionKey(row.id), null);
    marketChanged(world);
}

/**
 * An admin takes a listing down, bids or not: the leading bid goes back to its
 * bidder and the item to the seller. Coins already earned stay collectable.
 */
export function removeListing(world: World, listingId: string): ListingRecord {
    const { db } = world;
    const row = findListing(db, listingId);
    if (row.status !== "active") throw AppError.badRequest("That listing has already ended");
    returnHeldBid(db, row.id);
    returnToSeller(db, row);
    db.run(END_LISTING, row.id, "removed", Date.now());
    if (row.type === "auction") schedule(db, auctionKey(row.id), null);
    marketChanged(world);
    return row;
}

/** Pays a listing's earned coins to its seller. Returns how many. */
function collectOne(db: Db, sellerId: string, listingId: string): number {
    const row = findListing(db, listingId);
    if (row.seller_id !== sellerId) throw AppError.notFound("That listing is gone");
    const amount = row.proceeds - row.proceeds_collected;
    if (amount <= 0) return 0;
    db.run(MARK_COLLECTED, row.id);
    playerRepository.addCoins(db, sellerId, amount, "market-collect", `listing:${row.id}`);
    return amount;
}

export function collect(world: World, sellerId: string, listingId: string): number {
    settleAuction(world, listingId);
    return collectOne(world.db, sellerId, listingId);
}

export function collectAll(world: World, sellerId: string): number {
    settleEndedAuctions(world);
    let total = 0;
    for (const { id } of world.db.all<{ id: string }>(FIND_UNCOLLECTED_IDS, sellerId)) total += collectOne(world.db, sellerId, id);
    return total;
}

/**
 * Settles one auction if its time is up: the winner gets the item and their
 * held coins go onto the listing for the seller to collect; an auction nobody
 * bid on goes back to its seller. False if there was nothing to settle.
 */
export function settleAuction(world: World, listingId: string, now = Date.now()): boolean {
    const { db } = world;
    const row = db.one<ListingRecord>(FIND_LISTING, listingId);
    if (!row || row.status !== "active" || row.type !== "auction" || (row.ends_at ?? 0) > now) return false;
    const won = db.one<{ bidder_id: string; amount: number }>(SETTLE_HELD_BID, listingId, "won");
    if (won) {
        recordSale(db, listingId, won.bidder_id, row.quantity_left, won.amount);
        deliver(db, won.bidder_id, row, row.quantity_left);
    } else {
        returnToSeller(db, row);
        db.run(END_LISTING, listingId, "expired", now);
    }
    schedule(db, auctionKey(listingId), null);
    marketChanged(world);
    return true;
}

/**
 * Settles every auction whose time is up, each in its own savepoint: one
 * that fails (say, its item left the content) is logged and left for the
 * alarm's retry, and never holds back the others or the read that called this.
 */
export function settleEndedAuctions(world: World, now = Date.now()): number {
    let settled = 0;
    for (const { id } of world.db.all<{ id: string }>(FIND_ENDED_AUCTION_IDS, now)) {
        try {
            if (world.db.transaction(() => settleAuction(world, id, now))) settled++;
        } catch (error) {
            console.error(`market: settling auction ${id} failed:`, error);
        }
    }
    return settled;
}
