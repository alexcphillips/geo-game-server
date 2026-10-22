import type { GeoAdminAnnouncement, GeoAnnouncement, GeoInboxMessage, GeoInboxResponse } from "@geo/shared";
import type { NewAnnouncement, NewMessage } from "../../../../game/src/modules/inbox/geo-inbox.types";
import type { World } from "../../app";
import type { Db } from "../../db/db";
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
} from "./inbox.sql.ts";
import type { AnnouncementRecord, MessageRecord } from "./inbox.types";

/** Mail and announcements. */

const iso = (ms: number) => new Date(ms).toISOString();

function toMessage(row: MessageRecord): GeoInboxMessage {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        from: row.sent_by_name,
        feedback: row.feedback_title === null ? null : { title: row.feedback_title, body: row.feedback_body ?? "" },
        read: row.read === 1,
        createdAt: iso(row.created_at),
    };
}

function toAnnouncement(row: AnnouncementRecord): Omit<GeoAnnouncement, "read"> {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        version: row.version,
        createdAt: iso(row.created_at),
        expiresAt: row.expires_at === null ? null : iso(row.expires_at),
    };
}

/** The inbox as of now; `asOf` is what a later "mark read" counts up to. */
export function findInbox(db: Db, playerId: string): GeoInboxResponse {
    const now = Date.now();
    const messages = db.all<MessageRecord>(FIND_MESSAGES, playerId).map(toMessage);
    const announcements = db
        .all<AnnouncementRecord & { read: number }>(FIND_ANNOUNCEMENTS, playerId, now)
        .map((row) => ({ ...toAnnouncement(row), read: row.read === 1 }));
    return {
        messages,
        announcements,
        unread: [...messages, ...announcements].filter((mail) => !mail.read).length,
        asOf: iso(now),
    };
}

export function countUnread(db: Db, playerId: string): number {
    return db.one<{ count: number }>(COUNT_UNREAD, playerId, Date.now())?.count ?? 0;
}

/** Everything up to `asOf` (ms) counts as read. */
export function markRead(world: World, playerId: string, asOf: number) {
    world.db.run(MARK_MESSAGES_READ, playerId, Date.now(), asOf);
    world.db.run(MARK_ANNOUNCEMENTS_READ, playerId, asOf);
    // Another phone of theirs clears its badge too.
    world.db.afterCommit(() => world.hub.badgesChanged([playerId]));
}

export function insertMessage(world: World, message: NewMessage): string {
    const id = crypto.randomUUID();
    const { playerId, kind, title, body, sentBy, feedbackId } = message;
    world.db.run(INSERT_MESSAGE, id, playerId, kind, title, body, sentBy, feedbackId, Date.now());
    world.db.afterCommit(() => world.hub.badgesChanged([playerId]));
    return id;
}

export function insertAnnouncement(world: World, announcement: NewAnnouncement): string {
    const id = crypto.randomUUID();
    const { kind, title, body, version, postedBy, expiresAt } = announcement;
    world.db.run(INSERT_ANNOUNCEMENT, id, kind, title, body, version, postedBy, expiresAt?.getTime() ?? null, Date.now());
    world.db.afterCommit(() => world.hub.badgesChanged("everyone"));
    return id;
}

export function findAllAnnouncements(db: Db): GeoAdminAnnouncement[] {
    return db
        .all<AnnouncementRecord & { posted_by_name: string | null }>(FIND_ALL_ANNOUNCEMENTS)
        .map((row) => ({ ...toAnnouncement(row), postedBy: row.posted_by_name }));
}

/** The deleted announcement's kind and title, for the audit; null if there was none. */
export function deleteAnnouncement(world: World, id: string): { kind: string; title: string } | null {
    const row = world.db.one<{ kind: string; title: string }>(DELETE_ANNOUNCEMENT, id);
    if (row) world.db.afterCommit(() => world.hub.badgesChanged("everyone"));
    return row ? { kind: row.kind, title: row.title } : null;
}
