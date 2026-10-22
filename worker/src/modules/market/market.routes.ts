import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth, requirePlayerId } from "../../http/auth";
import { rateLimit } from "../../http/rate-limit";
import * as marketController from "./market.controller";

/** The Market: browse, list, buy, bid, cancel and collect. */
export const marketRoutes = new Hono<AppEnv>();

const paths = GEO_API_PATHS.market;
/** Trades per player per minute: plenty by hand, too few for a bot. */
const trade = rateLimit({ windowMs: 60_000, max: 60, key: (c) => `market:${requirePlayerId(c)}` });

marketRoutes.get(paths.root, auth, marketController.getMarket);
marketRoutes.get(paths.mine, auth, marketController.getOwnListings);
marketRoutes.post(paths.listings, auth, trade, marketController.createListing);
marketRoutes.post(paths.buy, auth, trade, marketController.buyListing);
marketRoutes.post(paths.bids, auth, trade, marketController.placeBid);
marketRoutes.post(paths.cancel, auth, trade, marketController.cancelListing);
marketRoutes.post(paths.collect, auth, trade, marketController.collect);
marketRoutes.post(paths.collectAll, auth, trade, marketController.collectAll);
marketRoutes.post(paths.buyStack, auth, trade, marketController.buyStack);
