import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import { rateLimit } from "../../middleware/rate-limit";
import * as suggestionsController from "./geo-suggestions.controller";

/** Players suggesting places. Reviewing them is in the admin module. */
export const geoSuggestionsRouter: Router = Router();

const suggestLimit = rateLimit({
    windowMs: 60 * 60_000,
    max: 10,
    key: (req) => `suggest:${req.geoPlayerId}`,
    message: "That's a lot of suggestions. Try again in an hour.",
});

geoSuggestionsRouter.post(
    GEO_API_PATHS.suggestions,
    geoAuth,
    suggestLimit,
    asyncHandler(suggestionsController.createSuggestion),
);
