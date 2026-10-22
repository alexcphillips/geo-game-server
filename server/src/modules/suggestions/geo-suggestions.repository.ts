import type { GeoAdminSuggestion, GeoSuggestionKind, GeoSuggestionStatus } from "@geo/shared";
import { query } from "../../db";
import type { TxQuery } from "../../db/transaction";
import {
    ACCEPT_FOR_PLACE,
    ADJUST_SUGGESTION,
    COUNT_SUGGESTIONS,
    FIND_SUGGESTION,
    FIND_SUGGESTIONS,
    INSERT_SUGGESTION,
    REVIEW_SUGGESTION,
} from "./geo-suggestions.sql";
import type { NewSuggestion, SuggestionRow } from "./geo-suggestions.types";

function toAdminSuggestion(row: SuggestionRow): GeoAdminSuggestion {
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
        reviewedAt: row.reviewed_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        placeId: row.place_id,
        originalLatitude: row.original_latitude,
        originalLongitude: row.original_longitude,
    };
}

export async function insertSuggestion(suggestion: NewSuggestion): Promise<string> {
    const [row] = await query<{ id: string }>(INSERT_SUGGESTION, [
        suggestion.playerId,
        suggestion.kind,
        suggestion.latitude,
        suggestion.longitude,
        suggestion.note,
        suggestion.playerLatitude,
        suggestion.playerLongitude,
        suggestion.gpsAccuracy,
        suggestion.distanceMetres,
    ]);
    return row!.id;
}

export async function findSuggestions(status: GeoSuggestionStatus | null): Promise<GeoAdminSuggestion[]> {
    return (await query<SuggestionRow>(FIND_SUGGESTIONS, [status])).map(toAdminSuggestion);
}

export async function findSuggestion(id: string): Promise<GeoAdminSuggestion | null> {
    const [row] = await query<SuggestionRow>(FIND_SUGGESTION, [id]);
    return row ? toAdminSuggestion(row) : null;
}

export async function countSuggestions(): Promise<Record<GeoSuggestionStatus, number>> {
    const counts: Record<GeoSuggestionStatus, number> = { open: 0, accepted: 0, rejected: 0 };
    for (const row of await query<{ status: GeoSuggestionStatus; count: string }>(COUNT_SUGGESTIONS)) {
        counts[row.status] = Number(row.count);
    }
    return counts;
}

export async function reviewSuggestion(
    tx: TxQuery,
    id: string,
    status: GeoSuggestionStatus,
    reviewNote: string | null,
    adminId: string,
): Promise<boolean> {
    return (await tx(REVIEW_SUGGESTION, [id, status, reviewNote, adminId])).length > 0;
}

/** Accepts a suggestion a place is being made from; false if there is none. */
export async function acceptForPlace(tx: TxQuery, id: string, adminId: string): Promise<boolean> {
    return (await tx(ACCEPT_FOR_PLACE, [id, adminId])).length > 0;
}

/** False if there is no such suggestion. Null leaves a field as it is. */
export async function adjustSuggestion(
    tx: TxQuery,
    id: string,
    kind: GeoSuggestionKind | null,
    point: { latitude: number; longitude: number } | null,
): Promise<boolean> {
    return (await tx(ADJUST_SUGGESTION, [id, kind, point?.latitude ?? null, point?.longitude ?? null])).length > 0;
}
