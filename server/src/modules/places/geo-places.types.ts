import type { GeoPlaceKind, GeoPlaceSettings } from "@geo/shared";

export type PlaceRow = {
    id: string;
    kind: GeoPlaceKind;
    name: string;
    description: string;
    latitude: number;
    longitude: number;
    settings: GeoPlaceSettings;
};

export type AdminPlaceRow = PlaceRow & {
    active: boolean;
    suggestion_id: string | null;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
};

export type NewPlace = {
    kind: GeoPlaceKind;
    name: string;
    description: string;
    latitude: number;
    longitude: number;
    settings: GeoPlaceSettings;
    createdBy: string;
    suggestionId: string | null;
};

/** Null leaves a field as it is. */
export type PlaceChanges = {
    kind: GeoPlaceKind | null;
    name: string | null;
    description: string | null;
    latitude: number | null;
    longitude: number | null;
    active: boolean | null;
    settings: GeoPlaceSettings | null;
};
