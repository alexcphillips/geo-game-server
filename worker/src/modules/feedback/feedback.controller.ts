import type { Context } from "hono";
import {
    GEO_FEEDBACK_BODY_MAX,
    GEO_FEEDBACK_KINDS,
    GEO_FEEDBACK_TITLE_MAX,
    type GeoFeedbackKind,
    type GeoFeedbackRequest,
    type GeoMyFeedbackResponse,
} from "@geo/shared";
import { AppError } from "../../../../server/src/http/AppError";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as feedbackRepository from "./feedback.repository";

type Ctx = Context<AppEnv>;

const isKind = (kind: unknown): kind is GeoFeedbackKind => GEO_FEEDBACK_KINDS.includes(kind as GeoFeedbackKind);

/** The app's own details: trimmed, capped, or null. Never trusted to be right. */
const detail = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 40) : null);

export function getMyFeedback(c: Ctx) {
    const body: GeoMyFeedbackResponse = { feedback: feedbackRepository.findMyFeedback(c.var.world.db, requirePlayerId(c)) };
    return c.json(body, 200);
}

/** Any player may send feedback: a bug, a suggestion, anything else. */
export async function createFeedback(c: Ctx) {
    const { kind, title, body, appVersion, platform } = (await jsonBody(c)) as Partial<Record<keyof GeoFeedbackRequest, unknown>>;
    if (!isKind(kind)) throw AppError.badRequest(`kind must be one of ${GEO_FEEDBACK_KINDS.join(", ")}`);
    const cleanTitle = typeof title === "string" ? title.trim() : "";
    if (!cleanTitle) throw AppError.badRequest("Give it a title");
    if (cleanTitle.length > GEO_FEEDBACK_TITLE_MAX) throw AppError.badRequest(`The title can be at most ${GEO_FEEDBACK_TITLE_MAX} characters`);
    if (body !== undefined && typeof body !== "string") throw AppError.badRequest("body must be text");
    const cleanBody = (body ?? "").trim();
    if (cleanBody.length > GEO_FEEDBACK_BODY_MAX) throw AppError.badRequest(`The description can be at most ${GEO_FEEDBACK_BODY_MAX} characters`);

    const playerId = requirePlayerId(c);
    const { db } = c.var.world;
    const feedback = db.transaction(() => {
        feedbackRepository.insertFeedback(db, {
            playerId,
            kind,
            title: cleanTitle,
            body: cleanBody,
            appVersion: detail(appVersion),
            platform: detail(platform),
        });
        return feedbackRepository.findMyFeedback(db, playerId);
    });
    const response: GeoMyFeedbackResponse = { feedback };
    return c.json(response, 201);
}
