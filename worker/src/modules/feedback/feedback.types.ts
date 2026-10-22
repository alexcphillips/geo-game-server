import type { GeoFeedbackKind, GeoFeedbackStatus } from "@geo/shared";

export type MyFeedbackRecord = {
    id: string;
    kind: GeoFeedbackKind;
    title: string;
    status: GeoFeedbackStatus;
    created_at: number;
    replies: number;
};

export type FeedbackRecord = {
    id: string;
    kind: GeoFeedbackKind;
    title: string;
    body: string;
    player_id: string | null;
    player_name: string | null;
    app_version: string | null;
    platform: string | null;
    status: GeoFeedbackStatus;
    updated_by: string | null;
    updated_at: number | null;
    created_at: number;
    /** JSON: [{ body, from, createdAt (ms) }], oldest first. */
    replies: string;
};
