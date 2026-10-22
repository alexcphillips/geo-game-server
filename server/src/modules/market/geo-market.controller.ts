import type { Request, Response } from "express";
import {
    GEO_AUCTION_HOURS,
    GEO_MAX_PRICE,
    GEO_VENDOR_MAX_QUANTITY,
    type GeoAuctionHours,
    type GeoBidRequest,
    type GeoBuyListingRequest,
    type GeoBuyStackRequest,
    type GeoCreateListingRequest,
} from "@geo/shared";
import { AppError } from "../../http/AppError";
import { CONTENT } from "../../content";
import { requirePlayerId } from "../../middleware/geo-auth";
import { isUuid, wholeNumber } from "../../lib/validate";
import * as playerRepository from "../player/geo-player.repository";
import * as marketRepository from "./geo-market.repository";

/** Most units one stack listing or purchase may move. */
const MAX_STACK_QUANTITY = GEO_VENDOR_MAX_QUANTITY;

function wholeNumberOf(value: unknown, name: string, min: number, max: number): number {
    return wholeNumber(value, min, max, AppError.badRequest(`${name} must be a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}`));
}

function listingId(req: Request): string {
    const id = String(req.params.listingId ?? "");
    if (!isUuid(id)) throw AppError.notFound("That listing is gone");
    return id;
}

/** Ended auctions are settled before anything is read or changed, so nobody sees one still running. */
async function settle() {
    await marketRepository.settleEndedAuctions();
}

/**
 * Settles just the listing about to be acted on, if it's an auction whose time
 * is up. A failure is logged, not thrown: the action then sees the auction as
 * ended and refuses on its own terms.
 */
async function settleOne(id: string) {
    try {
        await marketRepository.settleAuction(id);
    } catch (error) {
        console.error(`geo market: settling auction ${id} failed:`, error);
    }
}

async function replyWithMe(res: Response, playerId: string, status = 200) {
    res.status(status).json(await playerRepository.findMe(playerId));
}

export async function getMarket(req: Request, res: Response) {
    await settle();
    res.status(200).json(await marketRepository.findMarket(requirePlayerId(req)));
}

export async function getOwnListings(req: Request, res: Response) {
    await settle();
    res.status(200).json(await marketRepository.findOwnListings(requirePlayerId(req)));
}

export async function createListing(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const body = (req.body ?? {}) as Partial<GeoCreateListingRequest>;
    if (typeof body.inventoryId !== "string" || !body.inventoryId) throw AppError.badRequest("Missing inventoryId");
    if (body.type !== "auction" && body.type !== "bin") throw AppError.badRequest("type must be auction or bin");
    const quantity = wholeNumberOf(body.quantity, "quantity", 1, MAX_STACK_QUANTITY);

    let hours: GeoAuctionHours | undefined;
    if (body.type === "auction") {
        if (!GEO_AUCTION_HOURS.includes(body.hours as GeoAuctionHours)) {
            throw AppError.badRequest(`hours must be one of ${GEO_AUCTION_HOURS.join(", ")}`);
        }
        hours = body.hours;
    }

    await marketRepository.createListing(playerId, {
        inventoryId: body.inventoryId,
        type: body.type,
        quantity,
        price: body.type === "bin" ? wholeNumberOf(body.price, "price", 1, GEO_MAX_PRICE) : undefined,
        startingBid: body.type === "auction" ? wholeNumberOf(body.startingBid, "startingBid", 1, GEO_MAX_PRICE) : undefined,
        hours,
    });
    await replyWithMe(res, playerId, 201);
}

export async function buyListing(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const { expectedPrice } = (req.body ?? {}) as Partial<GeoBuyListingRequest>;
    await marketRepository.buyListing(playerId, listingId(req), wholeNumberOf(expectedPrice, "expectedPrice", 1, GEO_MAX_PRICE));
    await replyWithMe(res, playerId);
}

export async function buyStack(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const itemId = String(req.params.itemId);
    if (!CONTENT.items[itemId]) throw AppError.notFound("No such item");
    const { quantity, expectedTotal } = (req.body ?? {}) as Partial<GeoBuyStackRequest>;
    await marketRepository.buyStack(
        playerId,
        itemId,
        wholeNumberOf(quantity, "quantity", 1, MAX_STACK_QUANTITY),
        wholeNumberOf(expectedTotal, "expectedTotal", 1, GEO_MAX_PRICE),
    );
    await replyWithMe(res, playerId);
}

export async function placeBid(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const id = listingId(req);
    await settleOne(id);
    const { amount } = (req.body ?? {}) as Partial<GeoBidRequest>;
    await marketRepository.placeBid(playerId, id, wholeNumberOf(amount, "amount", 1, GEO_MAX_PRICE));
    await replyWithMe(res, playerId);
}

export async function cancelListing(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const id = listingId(req);
    await settleOne(id);
    await marketRepository.cancelListing(playerId, id);
    await replyWithMe(res, playerId);
}

export async function collect(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const id = listingId(req);
    await settleOne(id);
    await marketRepository.collect(playerId, id);
    await replyWithMe(res, playerId);
}

export async function collectAll(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    await settle();
    await marketRepository.collectAll(playerId);
    await replyWithMe(res, playerId);
}
