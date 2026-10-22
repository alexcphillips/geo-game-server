import type { Request, Response } from "express";
import {
    GEO_FEEDBACK_BODY_MAX,
    GEO_FEEDBACK_KINDS,
    GEO_FEEDBACK_TITLE_MAX,
    type GeoFeedbackKind,
    type GeoFeedbackRequest,
    type GeoMyFeedbackResponse,
} from "@geo/shared";
import { AppError } from "../../http/AppError";
import { requirePlayerId } from "../../middleware/geo-auth";
import * as feedbackRepository from "./geo-feedback.repository";

function isKind(kind: unknown): kind is GeoFeedbackKind {
    return GEO_FEEDBACK_KINDS.includes(kind as GeoFeedbackKind);
}

/** The app's own details: trimmed, capped, or null. Never trusted to be right. */
function detail(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 40) : null;
}

export async function getMyFeedback(req: Request, res: Response) {
    const body: GeoMyFeedbackResponse = { feedback: await feedbackRepository.findMyFeedback(requirePlayerId(req)) };
    res.status(200).json(body);
}

/** Any player may send feedback: a bug, a suggestion, anything else. */
export async function createFeedback(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const { kind, title, body, appVersion, platform } = (req.body ?? {}) as Partial<
        Record<keyof GeoFeedbackRequest, unknown>
    >;
    if (!isKind(kind)) throw AppError.badRequest(`kind must be one of ${GEO_FEEDBACK_KINDS.join(", ")}`);
    const cleanTitle = typeof title === "string" ? title.trim() : "";
    if (!cleanTitle) throw AppError.badRequest("Give it a title");
    if (cleanTitle.length > GEO_FEEDBACK_TITLE_MAX) {
        throw AppError.badRequest(`The title can be at most ${GEO_FEEDBACK_TITLE_MAX} characters`);
    }
    if (body !== undefined && typeof body !== "string") throw AppError.badRequest("body must be text");
    const cleanBody = (body ?? "").trim();
    if (cleanBody.length > GEO_FEEDBACK_BODY_MAX) {
        throw AppError.badRequest(`The description can be at most ${GEO_FEEDBACK_BODY_MAX} characters`);
    }

    await feedbackRepository.insertFeedback({
        playerId,
        kind,
        title: cleanTitle,
        body: cleanBody,
        appVersion: detail(appVersion),
        platform: detail(platform),
    });
    const response: GeoMyFeedbackResponse = { feedback: await feedbackRepository.findMyFeedback(playerId) };
    res.status(201).json(response);
}
