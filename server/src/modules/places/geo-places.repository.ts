import { distanceMetres, type GeoAdminPlace, type GeoPlace, type GeoPoint } from "@geo/shared";
import { query } from "../../db";
import type { TxQuery } from "../../db/transaction";
import {
    DELETE_PLACE,
    FIND_ACTIVE_IN_BOX,
    FIND_PLACE,
    FIND_PLACES,
    INSERT_PLACE,
    UPDATE_PLACE,
} from "./geo-places.sql";
import type { AdminPlaceRow, NewPlace, PlaceChanges, PlaceRow } from "./geo-places.types";

/** Most places one `GET /geo/places` returns. */
const MAX_NEARBY = 200;
const METRES_PER_DEGREE = 111_320;

function toPlace(row: PlaceRow): GeoPlace {
    return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        description: row.description,
        latitude: row.latitude,
        longitude: row.longitude,
        settings: row.settings,
    };
}

function toAdminPlace(row: AdminPlaceRow): GeoAdminPlace {
    return {
        ...toPlace(row),
        active: row.active,
        suggestionId: row.suggestion_id,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

/**
 * Active places within `radiusMetres`, nearest first. A box on latitude and
 * longitude narrows it in SQL (indexed), then the true distance trims it.
 */
export async function findPlacesNear(here: GeoPoint, radiusMetres: number): Promise<GeoPlace[]> {
    const dLat = radiusMetres / METRES_PER_DEGREE;
    // Near the poles a degree of longitude shrinks to nothing; cap the box.
    const dLng = Math.min(180, radiusMetres / (METRES_PER_DEGREE * Math.max(0.01, Math.cos((here.latitude * Math.PI) / 180))));
    const rows = await query<PlaceRow>(FIND_ACTIVE_IN_BOX, [
        here.latitude - dLat,
        here.latitude + dLat,
        here.longitude - dLng,
        here.longitude + dLng,
    ]);
    return rows
        .map((row) => ({ row, distance: distanceMetres(here, row) }))
        .filter(({ distance }) => distance <= radiusMetres)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, MAX_NEARBY)
        .map(({ row }) => toPlace(row));
}

export async function findPlaces(): Promise<GeoAdminPlace[]> {
    return (await query<AdminPlaceRow>(FIND_PLACES)).map(toAdminPlace);
}

export async function findPlace(id: string): Promise<GeoAdminPlace | null> {
    const [row] = await query<AdminPlaceRow>(FIND_PLACE, [id]);
    return row ? toAdminPlace(row) : null;
}

/** Throws Postgres' unique violation (23505) when the suggestion already has a place. */
export async function insertPlace(tx: TxQuery, place: NewPlace): Promise<string> {
    const [row] = await tx<{ id: string }>(INSERT_PLACE, [
        place.kind,
        place.name,
        place.description,
        place.latitude,
        place.longitude,
        place.settings,
        place.createdBy,
        place.suggestionId,
    ]);
    return row!.id;
}

export async function updatePlace(tx: TxQuery, id: string, changes: PlaceChanges): Promise<boolean> {
    const rows = await tx(UPDATE_PLACE, [
        id,
        changes.kind,
        changes.name,
        changes.description,
        changes.latitude,
        changes.longitude,
        changes.active,
        changes.settings,
    ]);
    return rows.length > 0;
}

/** The deleted row, or null if there was none. */
export async function deletePlace(tx: TxQuery, id: string): Promise<Record<string, unknown> | null> {
    const [row] = await tx<Record<string, unknown>>(DELETE_PLACE, [id]);
    return row ?? null;
}
