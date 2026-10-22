import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { rateLimit } from "../../middleware/rate-limit";
import * as accountsController from "./geo-accounts.controller";

/** Signing in. Every route is public: they're how a token is got. */
export const geoAccountsRouter: Router = Router();

/** Password guessing: a few tries a minute per address. */
const signInLimit = rateLimit({ windowMs: 60_000, max: 10 });
/** Mass sign-ups: a handful an hour per address. */
const registerLimit = rateLimit({
    windowMs: 60 * 60_000,
    max: 5,
    message: "Too many new accounts from here. Try again later.",
});
const refreshLimit = rateLimit({ windowMs: 60_000, max: 30 });

geoAccountsRouter.post(GEO_API_PATHS.auth.login, signInLimit, asyncHandler(accountsController.login));
geoAccountsRouter.post(GEO_API_PATHS.auth.register, registerLimit, asyncHandler(accountsController.register));
geoAccountsRouter.post(GEO_API_PATHS.auth.refresh, refreshLimit, asyncHandler(accountsController.refresh));
geoAccountsRouter.post(GEO_API_PATHS.auth.logout, refreshLimit, asyncHandler(accountsController.logout));
