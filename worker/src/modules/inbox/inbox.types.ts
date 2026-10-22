import type { GeoAnnouncementKind, GeoInboxMessage } from "@geo/shared";

/** A message as FIND_MESSAGES returns it. */
export type MessageRecord = {
    id: string;
    kind: GeoInboxMessage["kind"];
    title: string;
    body: string;
    sent_by_name: string | null;
    feedback_title: string | null;
    feedback_body: string | null;
    read: number;
    created_at: number;
};

export type AnnouncementRecord = {
    id: string;
    kind: GeoAnnouncementKind;
    title: string;
    body: string;
    version: string | null;
    expires_at: number | null;
    created_at: number;
};
