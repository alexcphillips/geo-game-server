import type { Context } from "hono";
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
import { CONTENT } from "../../../../server/src/content";
import { AppError } from "../../../../server/src/http/AppError";
import { wholeNumber } from "../../../../server/src/lib/validate";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import { changeMe } from "../player/player.controller";
import * as marketRepository from "./market.repository";

type Ctx = Context<AppEnv>;

/** Most units one stack listing or purchase may move. */
const MAX_STACK_QUANTITY = GEO_VENDOR_MAX_QUANTITY;

const wholeNumberOf = (value: unknown, name: string, min: number, max: number) =>
    wholeNumber(value, min, max, AppError.badRequest(`${name} must be a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}`));

const listingId = (c: Ctx) => c.req.param("listingId") ?? "";

/** Reads settle ended auctions first (they may write), so each runs in a transaction. */
export function getMarket(c: Ctx) {
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => marketRepository.findMarket(world, playerId)), 200);
}

export function getOwnListings(c: Ctx) {
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => marketRepository.findOwnListings(world, playerId)), 200);
}

export async function createListing(c: Ctx) {
    const body = (await jsonBody(c)) as Partial<GeoCreateListingRequest>;
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
    const listing = {
        inventoryId: body.inventoryId,
        type: body.type,
        quantity,
        price: body.type === "bin" ? wholeNumberOf(body.price, "price", 1, GEO_MAX_PRICE) : undefined,
        startingBid: body.type === "auction" ? wholeNumberOf(body.startingBid, "startingBid", 1, GEO_MAX_PRICE) : undefined,
        hours,
    };
    return changeMe(c, (_db, playerId) => marketRepository.createListing(c.var.world, playerId, listing), 201);
}

export async function buyListing(c: Ctx) {
    const { expectedPrice } = (await jsonBody(c)) as Partial<GeoBuyListingRequest>;
    const price = wholeNumberOf(expectedPrice, "expectedPrice", 1, GEO_MAX_PRICE);
    return changeMe(c, (_db, playerId) => marketRepository.buyListing(c.var.world, playerId, listingId(c), price));
}

export async function buyStack(c: Ctx) {
    const itemId = c.req.param("itemId") ?? "";
    if (!CONTENT.items[itemId]) throw AppError.notFound("No such item");
    const { quantity, expectedTotal } = (await jsonBody(c)) as Partial<GeoBuyStackRequest>;
    const units = wholeNumberOf(quantity, "quantity", 1, MAX_STACK_QUANTITY);
    const total = wholeNumberOf(expectedTotal, "expectedTotal", 1, GEO_MAX_PRICE);
    return changeMe(c, (_db, playerId) => marketRepository.buyStack(c.var.world, playerId, itemId, units, total));
}

export async function placeBid(c: Ctx) {
    const { amount } = (await jsonBody(c)) as Partial<GeoBidRequest>;
    const bid = wholeNumberOf(amount, "amount", 1, GEO_MAX_PRICE);
    return changeMe(c, (_db, playerId) => marketRepository.placeBid(c.var.world, playerId, listingId(c), bid));
}

export const cancelListing = (c: Ctx) =>
    changeMe(c, (_db, playerId) => marketRepository.cancelListing(c.var.world, playerId, listingId(c)));

export const collect = (c: Ctx) => changeMe(c, (_db, playerId) => void marketRepository.collect(c.var.world, playerId, listingId(c)));

export const collectAll = (c: Ctx) => changeMe(c, (_db, playerId) => void marketRepository.collectAll(c.var.world, playerId));
