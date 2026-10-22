import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import { rateLimit } from "../../middleware/rate-limit";
import * as feedbackController from "./geo-feedback.controller";

/** Players sending feedback. Triage and replies are in the admin module. */
export const geoFeedbackRouter: Router = Router();

const feedbackLimit = rateLimit({
    windowMs: 60 * 60_000,
    max: 10,
    key: (req) => `feedback:${req.geoPlayerId}`,
    message: "That's a lot of feedback. Try again in an hour.",
});

geoFeedbackRouter.get(GEO_API_PATHS.feedback, geoAuth, asyncHandler(feedbackController.getMyFeedback));
geoFeedbackRouter.post(GEO_API_PATHS.feedback, geoAuth, feedbackLimit, asyncHandler(feedbackController.createFeedback));
