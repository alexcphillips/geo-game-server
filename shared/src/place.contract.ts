/**
 * Hand-made places: skill hubs and landmarks a game admin puts on the map,
 * beside the ones the app finds in the map tiles. The app draws both alike.
 */
import type { GeoSuggestionKind } from "./suggestion.contract";

/** What a hand-made place can be: a skill hub, or a landmark. */
export const GEO_PLACE_KINDS = ["mining", "fishing", "farming", "foraging", "landmark"] as const satisfies readonly GeoSuggestionKind[];
export type GeoPlaceKind = (typeof GEO_PLACE_KINDS)[number];

export const GEO_PLACE_NAME_MAX = 60;
export const GEO_PLACE_DESCRIPTION_MAX = 280;

/**
 * How close a player must be to use a place, in metres: tile places and
 * hand-made ones alike (Pokémon Go's PokéStop reach).
 */
export const GEO_PLACE_REACH_METRES = 40;

/** `GET /geo/places` lists active places this far from the point, in metres. */
export const GEO_PLACES_RADIUS_METRES = 2_000;

/** Fishing tiers, poorest first: each lets rarer fish bite. */
export const GEO_FISHING_TIERS = ["puddle", "pond", "lake", "open"] as const;
export type GeoFishingTier = (typeof GEO_FISHING_TIERS)[number];

/** What a fishing place's water is called in the place modal. */
export const GEO_FISHING_WATERS = ["pond", "lake", "river", "ocean", "harbour", "pier"] as const;
export type GeoFishingWater = (typeof GEO_FISHING_WATERS)[number];

/**
 * A place's own settings, one section per kind; only the place's kind's
 * section is kept. A setting left out comes from the map, as for a tile place.
 */
export type GeoPlaceSettings = {
    fishing?: {
        tier?: GeoFishingTier;
        water?: GeoFishingWater;
    };
};

/** A hand-made place, as every player sees it. */
export type GeoPlace = {
    id: string;
    kind: GeoPlaceKind;
    /** Empty when there is none; the app then calls it by its type. */
    name: string;
    /** Empty when there is none. */
    description: string;
    latitude: number;
    longitude: number;
    settings: GeoPlaceSettings;
};

/** `GET /geo/places?latitude=…&longitude=…`: active places nearest first, at most 200. */
export type GeoPlacesResponse = {
    places: GeoPlace[];
    radiusMetres: number;
};

/** A place as the admin list shows it, inactive ones included. */
export type GeoAdminPlace = GeoPlace & {
    /** Inactive places are hidden from players but kept. */
    active: boolean;
    /** The suggestion it was made from, if any. */
    suggestionId: string | null;
    /** Null once that admin's account is deleted. */
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
};

/** `GET /geo/admin/places`: every place, newest first. */
export type GeoAdminPlacesResponse = {
    places: GeoAdminPlace[];
};

/**
 * `POST /geo/admin/places`. Replies 201 with the place. With `suggestionId`,
 * the place is linked to that suggestion and the suggestion is accepted.
 */
export type GeoAdminCreatePlaceRequest = {
    kind: GeoPlaceKind;
    name?: string;
    description?: string;
    latitude: number;
    longitude: number;
    settings?: GeoPlaceSettings;
    suggestionId?: string;
};

/**
 * `PATCH /geo/admin/places/:placeId`: only the fields sent change. Moving is
 * a new latitude and longitude. `settings` replaces the place's settings whole.
 */
export type GeoAdminUpdatePlaceRequest = Partial<{
    kind: GeoPlaceKind;
    name: string;
    description: string;
    latitude: number;
    longitude: number;
    active: boolean;
    settings: GeoPlaceSettings;
}>;
