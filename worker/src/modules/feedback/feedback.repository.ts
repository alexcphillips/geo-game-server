import { GEO_MAIL_TITLE_MAX, type GeoAdminFeedback, type GeoFeedbackStatus, type GeoMyFeedback } from "@geo/shared";
import { AppError } from "../../../../server/src/http/AppError";
import type { NewFeedback } from "../../../../server/src/modules/feedback/geo-feedback.types";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import { insertMessage } from "../inbox/inbox.repository";
import {
    COUNT_FEEDBACK,
    FIND_ALL_FEEDBACK,
    FIND_FEEDBACK_BY_STATUS,
    FIND_FEEDBACK_SENDER,
    FIND_MY_FEEDBACK,
    FIND_ONE_FEEDBACK,
    INSERT_FEEDBACK,
    MARK_SEEN,
    SET_STATUS,
} from "./feedback.sql.ts";
import type { FeedbackRecord, MyFeedbackRecord } from "./feedback.types";

/** Players' feedback and the admin's triage, from server/src/modules/feedback/geo-feedback.repository.ts. */

const iso = (ms: number) => new Date(ms).toISOString();

function toAdminFeedback(row: FeedbackRecord): GeoAdminFeedback {
    const replies = JSON.parse(row.replies) as { body: string; from: string | null; createdAt: number }[];
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
        updatedAt: row.updated_at === null ? null : iso(row.updated_at),
        createdAt: iso(row.created_at),
        replies: replies.map((reply) => ({ ...reply, createdAt: iso(reply.createdAt) })),
    };
}

function toMyFeedback(row: MyFeedbackRecord): GeoMyFeedback {
    return { id: row.id, kind: row.kind, title: row.title, status: row.status, replies: row.replies, createdAt: iso(row.created_at) };
}

export function insertFeedback(db: Db, feedback: NewFeedback): string {
    const id = crypto.randomUUID();
    const { playerId, kind, title, body, appVersion, platform } = feedback;
    db.run(INSERT_FEEDBACK, id, playerId, kind, title, body, appVersion, platform, Date.now());
    return id;
}

export function findMyFeedback(db: Db, playerId: string): GeoMyFeedback[] {
    return db.all<MyFeedbackRecord>(FIND_MY_FEEDBACK, playerId).map(toMyFeedback);
}

export function findFeedback(db: Db, status: GeoFeedbackStatus | null): GeoAdminFeedback[] {
    const rows = status === null ? db.all<FeedbackRecord>(FIND_ALL_FEEDBACK) : db.all<FeedbackRecord>(FIND_FEEDBACK_BY_STATUS, status);
    return rows.map(toAdminFeedback);
}

export function findOneFeedback(db: Db, id: string): GeoAdminFeedback | null {
    const row = db.one<FeedbackRecord>(FIND_ONE_FEEDBACK, id);
    return row ? toAdminFeedback(row) : null;
}

export function countFeedback(db: Db): Record<GeoFeedbackStatus, number> {
    const counts: Record<GeoFeedbackStatus, number> = { new: 0, seen: 0, planned: 0, done: 0, wontfix: 0 };
    for (const row of db.all<{ status: GeoFeedbackStatus; count: number }>(COUNT_FEEDBACK)) counts[row.status] = row.count;
    return counts;
}

/** False if there is no such feedback. */
export function setStatus(db: Db, id: string, status: GeoFeedbackStatus, adminId: string): boolean {
    return Boolean(db.one(SET_STATUS, status, adminId, Date.now(), id));
}

/**
 * Sends a reply to the player's inbox, titled after their feedback, and
 * marks new feedback seen. Not found if there's no such feedback; refused if
 * the player's account is gone, since nobody would read it.
 */
export function reply(world: World, id: string, body: string, adminId: string) {
    const feedback = world.db.one<{ id: string; player_id: string | null; title: string }>(FIND_FEEDBACK_SENDER, id);
    if (!feedback) throw AppError.notFound("Feedback not found");
    if (!feedback.player_id) throw AppError.badRequest("That player's account is gone");
    const title = `Re: ${feedback.title}`;
    insertMessage(world, {
        playerId: feedback.player_id,
        kind: "feedbackReply",
        title: title.length > GEO_MAIL_TITLE_MAX ? `${title.slice(0, GEO_MAIL_TITLE_MAX - 1)}…` : title,
        body,
        sentBy: adminId,
        feedbackId: id,
    });
    world.db.run(MARK_SEEN, adminId, Date.now(), id);
}
