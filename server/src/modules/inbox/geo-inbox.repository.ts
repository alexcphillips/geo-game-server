import type { GeoAdminAnnouncement, GeoAnnouncement, GeoInboxMessage, GeoInboxResponse } from "@geo/shared";
import { query } from "../../db";
import type { TxQuery } from "../../db/transaction";
import { badgesChanged } from "../../realtime/geo-badges";
import {
    COUNT_UNREAD,
    DELETE_ANNOUNCEMENT,
    FIND_ALL_ANNOUNCEMENTS,
    FIND_ANNOUNCEMENTS,
    FIND_MESSAGES,
    INSERT_ANNOUNCEMENT,
    INSERT_MESSAGE,
    MARK_ANNOUNCEMENTS_READ,
    MARK_MESSAGES_READ,
    NOW,
} from "./geo-inbox.sql";
import type { AnnouncementRow, MessageRow, NewAnnouncement, NewMessage } from "./geo-inbox.types";

function toMessage(row: MessageRow): GeoInboxMessage {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        from: row.sent_by_name,
        feedback: row.feedback_title === null ? null : { title: row.feedback_title, body: row.feedback_body ?? "" },
        read: row.read,
        createdAt: row.created_at.toISOString(),
    };
}

function toAnnouncement(row: AnnouncementRow): Omit<GeoAnnouncement, "read"> {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        version: row.version,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at?.toISOString() ?? null,
    };
}

export async function findInbox(playerId: string): Promise<GeoInboxResponse> {
    // The time first: anything arriving while the rest is read stays unread.
    const [clock] = await query<{ now: Date }>(NOW);
    const [messageRows, announcementRows] = await Promise.all([
        query<MessageRow>(FIND_MESSAGES, [playerId]),
        query<AnnouncementRow & { read: boolean }>(FIND_ANNOUNCEMENTS, [playerId]),
    ]);
    const messages = messageRows.map(toMessage);
    const announcements = announcementRows.map((row) => ({ ...toAnnouncement(row), read: row.read }));
    return {
        messages,
        announcements,
        unread: [...messages, ...announcements].filter((mail) => !mail.read).length,
        asOf: clock!.now.toISOString(),
    };
}

export async function countUnread(playerId: string): Promise<number> {
    const [row] = await query<{ count: string }>(COUNT_UNREAD, [playerId]);
    return Number(row?.count ?? 0);
}

/** Everything up to `asOf` counts as read. */
export async function markRead(playerId: string, asOf: Date): Promise<void> {
    await Promise.all([
        query(MARK_MESSAGES_READ, [playerId, asOf]),
        query(MARK_ANNOUNCEMENTS_READ, [playerId, asOf]),
    ]);
    // Another phone of theirs clears its badge too.
    badgesChanged(query, [playerId]);
}

export async function insertMessage(tx: TxQuery, message: NewMessage): Promise<string> {
    const [row] = await tx<{ id: string }>(INSERT_MESSAGE, [
        message.playerId,
        message.kind,
        message.title,
        message.body,
        message.sentBy,
        message.feedbackId,
    ]);
    badgesChanged(tx, [message.playerId]);
    return row!.id;
}

export async function insertAnnouncement(tx: TxQuery, announcement: NewAnnouncement): Promise<string> {
    const [row] = await tx<{ id: string }>(INSERT_ANNOUNCEMENT, [
        announcement.kind,
        announcement.title,
        announcement.body,
        announcement.version,
        announcement.postedBy,
        announcement.expiresAt,
    ]);
    badgesChanged(tx, "everyone");
    return row!.id;
}

export async function findAllAnnouncements(): Promise<GeoAdminAnnouncement[]> {
    const rows = await query<AnnouncementRow & { posted_by_name: string | null }>(FIND_ALL_ANNOUNCEMENTS);
    return rows.map((row) => ({ ...toAnnouncement(row), postedBy: row.posted_by_name }));
}

/** The deleted announcement's kind and title, for the audit; null if there was none. */
export async function deleteAnnouncement(
    tx: TxQuery,
    id: string,
): Promise<{ kind: string; title: string } | null> {
    const [row] = await tx<{ id: string; kind: string; title: string }>(DELETE_ANNOUNCEMENT, [id]);
    if (row) badgesChanged(tx, "everyone");
    return row ? { kind: row.kind, title: row.title } : null;
}
