/**
 * Location suggestions: a player says a real place should be a skill hub or
 * point of interest, and a game admin reviews it in-game.
 */

/** What a place could be. Wider than the skills that exist, on purpose. */
export const GEO_SUGGESTION_KINDS = ["mining", "fishing", "farming", "foraging", "landmark", "other"] as const;
export type GeoSuggestionKind = (typeof GEO_SUGGESTION_KINDS)[number];

/** The longest note a suggestion may carry. */
export const GEO_SUGGESTION_NOTE_MAX = 280;

/** `POST /geo/suggestions`. Replies 201 with `{ id }`. */
export type GeoSuggestionRequest = {
    kind: GeoSuggestionKind;
    /** The suggested spot: a dropped pin, or where the player stands. */
    latitude: number;
    longitude: number;
    note: string;
    /** Where the player was when they sent it, so a reviewer can tell if they were there. */
    player: {
        latitude: number;
        longitude: number;
        /** GPS accuracy in metres; null when the phone didn't say. */
        accuracy: number | null;
    };
};

export type GeoSuggestionStatus = "open" | "accepted" | "rejected";

/** A suggestion as the admin review list shows it. */
export type GeoAdminSuggestion = {
    id: string;
    kind: GeoSuggestionKind;
    latitude: number;
    longitude: number;
    note: string;
    /** Null once that player's account is deleted; the suggestion stays. */
    playerId: string | null;
    playerName: string | null;
    playerLatitude: number;
    playerLongitude: number;
    gpsAccuracy: number | null;
    /** From the player to the pin when sent, in metres. */
    distanceMetres: number;
    status: GeoSuggestionStatus;
    reviewNote: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    createdAt: string;
    /** The hand-made place made from it, if any. */
    placeId: string | null;
    /** Where the player put the pin, once an admin has moved it; null if never moved. */
    originalLatitude: number | null;
    originalLongitude: number | null;
};

/** `GET /geo/admin/suggestions?status=open`: newest first, at most 200. */
export type GeoAdminSuggestionsResponse = {
    suggestions: GeoAdminSuggestion[];
    /** Every suggestion by status, for the filter's labels. */
    counts: Record<GeoSuggestionStatus, number>;
};

/**
 * `PUT /geo/admin/suggestions/:suggestionId`: reject, or "open" to reopen a
 * reviewed one. "accepted" is refused: a suggestion is accepted by creating
 * its place (`POST /geo/admin/places` with its id).
 */
export type GeoAdminReviewSuggestionRequest = {
    status: GeoSuggestionStatus;
    reviewNote?: string;
};

/**
 * `PATCH /geo/admin/suggestions/:suggestionId`: an admin corrects a
 * suggestion, e.g. a pin dropped a little off. Only the fields sent change;
 * the player's note stays as they wrote it. Replies with the suggestion.
 */
export type GeoAdminAdjustSuggestionRequest = Partial<{
    kind: GeoSuggestionKind;
    latitude: number;
    longitude: number;
}>;
