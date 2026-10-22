import type { NewAnnouncement, NewMessage } from "../../../../server/src/modules/inbox/geo-inbox.types";
import type { World } from "../../app";
import { INSERT_ANNOUNCEMENT, INSERT_MESSAGE } from "./inbox.sql.ts";

/** Mail and announcements, written by other modules (farm contests). From server/src/modules/inbox/geo-inbox.repository.ts. */

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
