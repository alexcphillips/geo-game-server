import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { rateLimit } from "../../http/rate-limit";
import * as accountsController from "./accounts.controller";

/** Signing in. Every route is public: they're how a token is got. */
export const accountsRoutes = new Hono<AppEnv>();

/** Password guessing: a few tries a minute per address. */
const signInLimit = rateLimit({ windowMs: 60_000, max: 10 });
/** Mass sign-ups: a handful an hour per address. */
const registerLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, message: "Too many new accounts from here. Try again later." });
const refreshLimit = rateLimit({ windowMs: 60_000, max: 30 });

accountsRoutes.post(GEO_API_PATHS.auth.login, signInLimit, accountsController.login);
accountsRoutes.post(GEO_API_PATHS.auth.register, registerLimit, accountsController.register);
accountsRoutes.post(GEO_API_PATHS.auth.refresh, refreshLimit, accountsController.refresh);
accountsRoutes.post(GEO_API_PATHS.auth.logout, refreshLimit, accountsController.logout);
