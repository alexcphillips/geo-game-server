/**
 * Friends: mutual, by username. A request waits until the other player
 * accepts; declining, cancelling and removing all just delete the row.
 *
 * Presence comes from the geo socket: a player is online while their app
 * has it open. The app says what the player is doing (POST presence) when
 * that changes; friends with the list open get a `changed: friends` hint.
 * Activity says what, never where.
 */

/** Friends plus requests either way, per player. */
export const GEO_FRIENDS_MAX = 200;

/** What a player is doing, as their app reports it. */
export const GEO_ACTIVITIES = ["exploring", "fighting", "skilling", "trading"] as const;
export type GeoActivity = (typeof GEO_ACTIVITIES)[number];

/** POST, when it changes: doing this now. `skill` only with `skilling`. Ignored while the player has no geo socket. */
export type GeoPresenceRequest = {
    activity: GeoActivity;
    skill?: string | null;
};

/** What the HUD badges show; pushed over the geo socket on connect and whenever a count changes. */
export type GeoBadges = {
    incomingRequests: number;
    /** Unread inbox mail (messages and announcements). */
    unreadInbox: number;
    /** Chest selections won but not opened yet: the inbox's Chests tab. */
    pendingChests: number;
};

export type GeoFriendStatus =
    | { online: true; activity: GeoActivity; skill: string | null }
    | { online: false; lastSeenAt: string | null };

export type GeoFriend = {
    playerId: string;
    name: string;
    status: GeoFriendStatus;
    /** When the request was accepted. */
    since: string;
};

export type GeoFriendRequest = {
    id: string;
    /** The other player: the sender of an incoming request, the receiver of an outgoing one. */
    playerId: string;
    name: string;
    createdAt: string;
};

export type GeoFriendsResponse = {
    /** Online first, then by name. */
    friends: GeoFriend[];
    incoming: GeoFriendRequest[];
    outgoing: GeoFriendRequest[];
};

/** POST: ask a player, by username, to be friends. */
export type GeoSendFriendRequest = {
    username: string;
};

/**
 * `accepted` when they had already asked you: asking back accepts theirs
 * rather than making a second request.
 */
export type GeoSendFriendResponse = {
    result: "sent" | "accepted";
};
