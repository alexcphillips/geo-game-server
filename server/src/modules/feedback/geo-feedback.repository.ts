import {
    GEO_MAIL_TITLE_MAX,
    type GeoAdminFeedback,
    type GeoFeedbackStatus,
    type GeoMyFeedback,
} from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import type { TxQuery } from "../../db/transaction";
import { insertMessage } from "../inbox/geo-inbox.repository";
import {
    COUNT_FEEDBACK,
    FIND_FEEDBACK,
    FIND_MY_FEEDBACK,
    FIND_ONE_FEEDBACK,
    INSERT_FEEDBACK,
    LOCK_FEEDBACK,
    MARK_SEEN,
    SET_STATUS,
} from "./geo-feedback.sql";
import type { FeedbackRow, MyFeedbackRow, NewFeedback } from "./geo-feedback.types";

function toAdminFeedback(row: FeedbackRow): GeoAdminFeedback {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        playerId: row.player_id,
        playerName: row.player_name,
        appVersion: row.app_version,
        platform: row.platform,
        status: row.status,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        replies: row.replies.map((reply) => ({ ...reply, createdAt: new Date(reply.createdAt).toISOString() })),
    };
}

function toMyFeedback(row: MyFeedbackRow): GeoMyFeedback {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        status: row.status,
        replies: Number(row.replies),
        createdAt: row.created_at.toISOString(),
    };
}

export async function insertFeedback(feedback: NewFeedback): Promise<string> {
    const [row] = await query<{ id: string }>(INSERT_FEEDBACK, [
        feedback.playerId,
        feedback.kind,
        feedback.title,
        feedback.body,
        feedback.appVersion,
        feedback.platform,
    ]);
    return row!.id;
}

export async function findMyFeedback(playerId: string): Promise<GeoMyFeedback[]> {
    return (await query<MyFeedbackRow>(FIND_MY_FEEDBACK, [playerId])).map(toMyFeedback);
}

export async function findFeedback(status: GeoFeedbackStatus | null): Promise<GeoAdminFeedback[]> {
    return (await query<FeedbackRow>(FIND_FEEDBACK, [status])).map(toAdminFeedback);
}

export async function findOneFeedback(id: string): Promise<GeoAdminFeedback | null> {
    const [row] = await query<FeedbackRow>(FIND_ONE_FEEDBACK, [id]);
    return row ? toAdminFeedback(row) : null;
}

export async function countFeedback(): Promise<Record<GeoFeedbackStatus, number>> {
    const counts: Record<GeoFeedbackStatus, number> = { new: 0, seen: 0, planned: 0, done: 0, wontfix: 0 };
    for (const row of await query<{ status: GeoFeedbackStatus; count: string }>(COUNT_FEEDBACK)) {
        counts[row.status] = Number(row.count);
    }
    return counts;
}

/** False if there is no such feedback. */
export async function setStatus(tx: TxQuery, id: string, status: GeoFeedbackStatus, adminId: string): Promise<boolean> {
    return (await tx(SET_STATUS, [id, status, adminId])).length > 0;
}

/**
 * Sends a reply to the player's inbox, titled after their feedback, and
 * marks new feedback seen. Not found if there's no such feedback; refused if
 * the player's account is gone, since nobody would read it.
 */
export async function reply(tx: TxQuery, id: string, body: string, adminId: string): Promise<void> {
    const [feedback] = await tx<{ id: string; player_id: string | null; title: string }>(LOCK_FEEDBACK, [id]);
    if (!feedback) throw AppError.notFound("Feedback not found");
    if (!feedback.player_id) throw AppError.badRequest("That player's account is gone");
    const title = `Re: ${feedback.title}`;
    await insertMessage(tx, {
        playerId: feedback.player_id,
        kind: "feedbackReply",
        title: title.length > GEO_MAIL_TITLE_MAX ? `${title.slice(0, GEO_MAIL_TITLE_MAX - 1)}…` : title,
        body,
        sentBy: adminId,
        feedbackId: id,
    });
    await tx(MARK_SEEN, [id, adminId]);
}
