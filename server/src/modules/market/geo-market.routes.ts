import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import { rateLimit } from "../../middleware/rate-limit";
import * as marketController from "./geo-market.controller";

/** The Market: browse, list, buy, bid, cancel and collect. */
export const geoMarketRouter: Router = Router();

const paths = GEO_API_PATHS.market;
/** Trades per player per minute: plenty by hand, too few for a bot. */
const tradeLimit = rateLimit({ windowMs: 60_000, max: 60, key: (req) => `market:${req.geoPlayerId}` });
const trade = [geoAuth, tradeLimit];

geoMarketRouter.get(paths.root, geoAuth, asyncHandler(marketController.getMarket));
geoMarketRouter.get(paths.mine, geoAuth, asyncHandler(marketController.getOwnListings));
geoMarketRouter.post(paths.listings, trade, asyncHandler(marketController.createListing));
geoMarketRouter.post(paths.buy, trade, asyncHandler(marketController.buyListing));
geoMarketRouter.post(paths.bids, trade, asyncHandler(marketController.placeBid));
geoMarketRouter.post(paths.cancel, trade, asyncHandler(marketController.cancelListing));
geoMarketRouter.post(paths.collect, trade, asyncHandler(marketController.collect));
geoMarketRouter.post(paths.collectAll, trade, asyncHandler(marketController.collectAll));
geoMarketRouter.post(paths.buyStack, trade, asyncHandler(marketController.buyStack));
