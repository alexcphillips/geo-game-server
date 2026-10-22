import type { GeoAnnouncementKind, GeoInboxMessage } from "@geo/shared";

export type MessageRow = {
    id: string;
    kind: GeoInboxMessage["kind"];
    title: string;
    body: string;
    sent_by_name: string | null;
    feedback_title: string | null;
    feedback_body: string | null;
    read: boolean;
    created_at: Date;
};

export type AnnouncementRow = {
    id: string;
    kind: GeoAnnouncementKind;
    title: string;
    body: string;
    version: string | null;
    expires_at: Date | null;
    created_at: Date;
};

export type NewMessage = {
    playerId: string;
    kind: GeoInboxMessage["kind"];
    title: string;
    body: string;
    sentBy: string | null;
    feedbackId: string | null;
};

export type NewAnnouncement = {
    kind: GeoAnnouncementKind;
    title: string;
    body: string;
    version: string | null;
    postedBy: string | null;
    expiresAt: Date | null;
};
