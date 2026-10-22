import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth, requirePlayerId } from "../../http/auth";
import { rateLimit } from "../../http/rate-limit";
import * as feedbackController from "./feedback.controller";

/** Players sending feedback. Triage and replies are in the admin module. */
export const feedbackRoutes = new Hono<AppEnv>();

const feedbackLimit = rateLimit({
    windowMs: 60 * 60_000,
    max: 10,
    key: (c) => `feedback:${requirePlayerId(c)}`,
    message: "That's a lot of feedback. Try again in an hour.",
});

feedbackRoutes.get(GEO_API_PATHS.feedback, auth, feedbackController.getMyFeedback);
feedbackRoutes.post(GEO_API_PATHS.feedback, auth, feedbackLimit, feedbackController.createFeedback);
