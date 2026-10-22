import type { GeoAdminSuggestion, GeoSuggestionKind, GeoSuggestionStatus } from "@geo/shared";
import type { NewSuggestion } from "../../../../game/src/modules/suggestions/geo-suggestions.types";
import type { Db } from "../../db/db";
import {
    ACCEPT_FOR_PLACE,
    ADJUST_SUGGESTION,
    COUNT_SUGGESTIONS,
    FIND_ALL_SUGGESTIONS,
    FIND_SUGGESTION,
    FIND_SUGGESTIONS_BY_STATUS,
    INSERT_SUGGESTION,
    REVIEW_SUGGESTION,
} from "./suggestions.sql.ts";
import type { SuggestionRecord } from "./suggestions.types";

/** Places players suggest, and their review. */

const iso = (ms: number) => new Date(ms).toISOString();

function toAdminSuggestion(row: SuggestionRecord): GeoAdminSuggestion {
    return {
        id: row.id,
        kind: row.kind,
        latitude: row.latitude,
        longitude: row.longitude,
        note: row.note,
        playerId: row.player_id,
        playerName: row.player_name,
        playerLatitude: row.player_latitude,
        playerLongitude: row.player_longitude,
        gpsAccuracy: row.gps_accuracy,
        distanceMetres: Math.round(row.distance_metres),
        status: row.status,
        reviewNote: row.review_note,
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at === null ? null : iso(row.reviewed_at),
        createdAt: iso(row.created_at),
        placeId: row.place_id,
        originalLatitude: row.original_latitude,
        originalLongitude: row.original_longitude,
    };
}

export function insertSuggestion(db: Db, suggestion: NewSuggestion): string {
    const id = crypto.randomUUID();
    const { playerId, kind, latitude, longitude, note, playerLatitude, playerLongitude, gpsAccuracy, distanceMetres } = suggestion;
    db.run(INSERT_SUGGESTION, id, playerId, kind, latitude, longitude, note, playerLatitude, playerLongitude, gpsAccuracy, distanceMetres, Date.now());
    return id;
}

export function findSuggestions(db: Db, status: GeoSuggestionStatus | null): GeoAdminSuggestion[] {
    const rows =
        status === null ? db.all<SuggestionRecord>(FIND_ALL_SUGGESTIONS) : db.all<SuggestionRecord>(FIND_SUGGESTIONS_BY_STATUS, status);
    return rows.map(toAdminSuggestion);
}

export function findSuggestion(db: Db, id: string): GeoAdminSuggestion | null {
    const row = db.one<SuggestionRecord>(FIND_SUGGESTION, id);
    return row ? toAdminSuggestion(row) : null;
}

export function countSuggestions(db: Db): Record<GeoSuggestionStatus, number> {
    const counts: Record<GeoSuggestionStatus, number> = { open: 0, accepted: 0, rejected: 0 };
    for (const row of db.all<{ status: GeoSuggestionStatus; count: number }>(COUNT_SUGGESTIONS)) counts[row.status] = row.count;
    return counts;
}

export function reviewSuggestion(db: Db, id: string, status: GeoSuggestionStatus, reviewNote: string | null, adminId: string): boolean {
    return Boolean(db.one(REVIEW_SUGGESTION, id, status, reviewNote, adminId, Date.now()));
}

/** Accepts a suggestion a place is being made from; false if there is none. */
export function acceptForPlace(db: Db, id: string, adminId: string): boolean {
    return Boolean(db.one(ACCEPT_FOR_PLACE, id, adminId, Date.now()));
}

/** False if there is no such suggestion. Null leaves a field as it is. */
export function adjustSuggestion(
    db: Db,
    id: string,
    kind: GeoSuggestionKind | null,
    point: { latitude: number; longitude: number } | null,
): boolean {
    return Boolean(db.one(ADJUST_SUGGESTION, id, kind, point?.latitude ?? null, point?.longitude ?? null));
}
