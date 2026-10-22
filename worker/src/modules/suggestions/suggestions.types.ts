import type { GeoSuggestionKind, GeoSuggestionStatus } from "@geo/shared";

export type SuggestionRecord = {
    id: string;
    kind: GeoSuggestionKind;
    latitude: number;
    longitude: number;
    note: string;
    player_id: string | null;
    player_name: string | null;
    player_latitude: number;
    player_longitude: number;
    gps_accuracy: number | null;
    distance_metres: number;
    status: GeoSuggestionStatus;
    review_note: string | null;
    reviewed_by: string | null;
    reviewed_at: number | null;
    created_at: number;
    place_id: string | null;
    original_latitude: number | null;
    original_longitude: number | null;
};
