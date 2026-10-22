import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth, requirePlayerId } from "../../http/auth";
import { rateLimit } from "../../http/rate-limit";
import * as suggestionsController from "./suggestions.controller";

/** Players suggesting places. Reviewing them is in the admin module. */
export const suggestionsRoutes = new Hono<AppEnv>();

const suggestLimit = rateLimit({
    windowMs: 60 * 60_000,
    max: 10,
    key: (c) => `suggest:${requirePlayerId(c)}`,
    message: "That's a lot of suggestions. Try again in an hour.",
});

suggestionsRoutes.post(GEO_API_PATHS.suggestions, auth, suggestLimit, suggestionsController.createSuggestion);
