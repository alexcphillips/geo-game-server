/**
 * The inbox, and the feedback that feeds part of it.
 *
 * Two kinds of mail, stored differently:
 * - **Messages** are for one player (a reply to their feedback, their farm
 *   contest results): a row each, read when the player opens the inbox.
 * - **Announcements** are for everyone (news, changelogs, events, a new
 *   mayor): one row in all, never copied per player. Each player keeps one
 *   "read up to" time; announcements after it are unread.
 *
 * Friend requests are not mail: they live with friends.
 */

export const GEO_ANNOUNCEMENT_KINDS = ["news", "changelog", "event", "mayor"] as const;
export type GeoAnnouncementKind = (typeof GEO_ANNOUNCEMENT_KINDS)[number];
/** What an admin may post by hand; `mayor` is the server's own, when an election closes. */
export const GEO_POSTABLE_ANNOUNCEMENT_KINDS = ["news", "changelog", "event"] as const;
export type GeoPostableAnnouncementKind = (typeof GEO_POSTABLE_ANNOUNCEMENT_KINDS)[number];

export const GEO_MAIL_TITLE_MAX = 80;
export const GEO_MAIL_BODY_MAX = 4000;

export type GeoInboxMessage = {
    id: string;
    /** A reply to the player's feedback, or their farm contest results. */
    kind: "feedbackReply" | "contest";
    title: string;
    body: string;
    /** The admin's display name; null once their account is gone. */
    from: string | null;
    /** The feedback replied to, quoted under the reply. Null if it was deleted. */
    feedback: { title: string; body: string } | null;
    read: boolean;
    createdAt: string;
};

export type GeoAnnouncement = {
    id: string;
    kind: GeoAnnouncementKind;
    title: string;
    body: string;
    /** Changelogs only: the app version it describes, e.g. "1.2.0". */
    version: string | null;
    read: boolean;
    createdAt: string;
    /** Gone from the inbox after this; null for never. */
    expiresAt: string | null;
};

/** `GET /geo/inbox`: newest first, at most 100 of each. */
export type GeoInboxResponse = {
    messages: GeoInboxMessage[];
    announcements: GeoAnnouncement[];
    unread: number;
    /** The server's time when this was read; send it back to mark these read. */
    asOf: string;
};

/**
 * `POST /geo/inbox/read`: everything up to `asOf` (from the inbox it saw)
 * counts as read, so mail that arrived since stays unread. Replies 204.
 */
export type GeoInboxReadRequest = {
    asOf: string;
};

/* ── Feedback ─────────────────────────────────────────────────────────── */

export const GEO_FEEDBACK_KINDS = ["bug", "suggestion", "other"] as const;
export type GeoFeedbackKind = (typeof GEO_FEEDBACK_KINDS)[number];

export const GEO_FEEDBACK_STATUSES = ["new", "seen", "planned", "done", "wontfix"] as const;
export type GeoFeedbackStatus = (typeof GEO_FEEDBACK_STATUSES)[number];

export const GEO_FEEDBACK_TITLE_MAX = 80;
export const GEO_FEEDBACK_BODY_MAX = 2000;

/** `POST /geo/feedback`. Replies 201 with the player's feedback list. */
export type GeoFeedbackRequest = {
    kind: GeoFeedbackKind;
    title: string;
    body: string;
    /** Filled in by the app, not the player: what a bug report needs. */
    appVersion: string | null;
    platform: string | null;
};

/** The player's own feedback, as Settings → Feedback lists it. */
export type GeoMyFeedback = {
    id: string;
    kind: GeoFeedbackKind;
    title: string;
    status: GeoFeedbackStatus;
    replies: number;
    createdAt: string;
};

/** `GET /geo/feedback`: the player's own, newest first. */
export type GeoMyFeedbackResponse = {
    feedback: GeoMyFeedback[];
};

/** Feedback as the admin list shows it. */
export type GeoAdminFeedback = {
    id: string;
    kind: GeoFeedbackKind;
    title: string;
    body: string;
    /** Null once that player's account is deleted; the feedback stays. */
    playerId: string | null;
    playerName: string | null;
    appVersion: string | null;
    platform: string | null;
    status: GeoFeedbackStatus;
    /** Who last changed the status, and when. */
    updatedBy: string | null;
    updatedAt: string | null;
    createdAt: string;
    /** Every reply sent to the player, oldest first. */
    replies: { body: string; from: string | null; createdAt: string }[];
};

/** `GET /geo/admin/feedback?status=`: newest first, at most 200. */
export type GeoAdminFeedbackResponse = {
    feedback: GeoAdminFeedback[];
    counts: Record<GeoFeedbackStatus, number>;
};

/** `PATCH /geo/admin/feedback/:feedbackId`. Replies with the feedback. */
export type GeoAdminFeedbackStatusRequest = {
    status: GeoFeedbackStatus;
};

/**
 * `POST /geo/admin/feedback/:feedbackId/replies`: lands in the player's
 * inbox. New feedback becomes "seen". Replies with the feedback.
 */
export type GeoAdminFeedbackReplyRequest = {
    body: string;
};

/** `POST /geo/admin/announcements`. Replies 201 with the admin list. */
export type GeoAdminAnnouncementRequest = {
    kind: GeoPostableAnnouncementKind;
    title: string;
    body: string;
    /** Changelogs need one, e.g. "1.2.0". */
    version?: string;
    /** Hours until it leaves the inbox; omitted for never. */
    expiresInHours?: number;
};

/** `GET /geo/admin/announcements`: every announcement, expired too, newest first. */
export type GeoAdminAnnouncement = Omit<GeoAnnouncement, "read"> & {
    /** The admin who posted it; null for the server's own (a new mayor). */
    postedBy: string | null;
};

export type GeoAdminAnnouncementsResponse = {
    announcements: GeoAdminAnnouncement[];
};
