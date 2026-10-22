import type { GeoFeedbackKind, GeoFeedbackStatus } from "@geo/shared";

export type MyFeedbackRow = {
    id: string;
    kind: GeoFeedbackKind;
    title: string;
    status: GeoFeedbackStatus;
    created_at: Date;
    replies: string;
};

export type FeedbackRow = {
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
    updated_at: Date | null;
    created_at: Date;
    /** From json_agg, so the times are strings. */
    replies: { body: string; from: string | null; createdAt: string }[];
};

export type NewFeedback = {
    playerId: string;
    kind: GeoFeedbackKind;
    title: string;
    body: string;
    appVersion: string | null;
    platform: string | null;
};
