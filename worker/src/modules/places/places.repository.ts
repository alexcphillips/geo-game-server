import { distanceMetres, type GeoAdminPlace, type GeoPlace, type GeoPlaceKind, type GeoPlaceSettings, type GeoPoint } from "@geo/shared";
import type { NewPlace, PlaceChanges } from "../../../../game/src/modules/places/geo-places.types";
import type { Db } from "../../db/db";
import {
    DELETE_PLACE,
    FIND_ACTIVE_IN_BOX,
    FIND_PLACE,
    FIND_PLACE_FOR_SUGGESTION,
    FIND_PLACES,
    INSERT_PLACE,
    UPDATE_PLACE,
} from "./places.sql.ts";

/** A place row as stored; `settings` is JSON. */
type PlaceRecord = {
    id: string;
    kind: GeoPlaceKind;
    name: string;
    description: string;
    latitude: number;
    longitude: number;
    settings: string;
};

type AdminPlaceRecord = PlaceRecord & {
    active: number;
    suggestion_id: string | null;
    created_by: string | null;
    created_at: number;
    updated_at: number;
};

/** Most places one `GET /geo/places` returns. */
const MAX_NEARBY = 200;
const METRES_PER_DEGREE = 111_320;

function toPlace(row: PlaceRecord): GeoPlace {
    return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        description: row.description,
        latitude: row.latitude,
        longitude: row.longitude,
        settings: JSON.parse(row.settings) as GeoPlaceSettings,
    };
}

/**
 * Active places within `radiusMetres`, nearest first. A box on latitude and
 * longitude narrows it in SQL (indexed), then the true distance trims it.
 */
export function findPlacesNear(db: Db, here: GeoPoint, radiusMetres: number): GeoPlace[] {
    const dLat = radiusMetres / METRES_PER_DEGREE;
    // Near the poles a degree of longitude shrinks to nothing; cap the box.
    const dLng = Math.min(180, radiusMetres / (METRES_PER_DEGREE * Math.max(0.01, Math.cos((here.latitude * Math.PI) / 180))));
    const rows = db.all<PlaceRecord>(
        FIND_ACTIVE_IN_BOX,
        here.latitude - dLat,
        here.latitude + dLat,
        here.longitude - dLng,
        here.longitude + dLng,
    );
    return rows
        .map((row) => ({ row, distance: distanceMetres(here, row) }))
        .filter(({ distance }) => distance <= radiusMetres)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, MAX_NEARBY)
        .map(({ row }) => toPlace(row));
}

function toAdminPlace(row: AdminPlaceRecord): GeoAdminPlace {
    return {
        ...toPlace(row),
        active: row.active === 1,
        suggestionId: row.suggestion_id,
        createdBy: row.created_by,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
    };
}

export function findPlaces(db: Db): GeoAdminPlace[] {
    return db.all<AdminPlaceRecord>(FIND_PLACES).map(toAdminPlace);
}

export function findPlace(db: Db, id: string): GeoAdminPlace | null {
    const row = db.one<AdminPlaceRecord>(FIND_PLACE, id);
    return row ? toAdminPlace(row) : null;
}

export function suggestionHasPlace(db: Db, suggestionId: string): boolean {
    return Boolean(db.one(FIND_PLACE_FOR_SUGGESTION, suggestionId));
}

export function insertPlace(db: Db, place: NewPlace): string {
    const id = crypto.randomUUID();
    const { kind, name, description, latitude, longitude, settings, createdBy, suggestionId } = place;
    db.run(INSERT_PLACE, id, kind, name, description, latitude, longitude, JSON.stringify(settings), createdBy, suggestionId, Date.now());
    return id;
}

export function updatePlace(db: Db, id: string, changes: PlaceChanges): boolean {
    const { kind, name, description, latitude, longitude, active, settings } = changes;
    const row = db.one(
        UPDATE_PLACE,
        id,
        kind,
        name,
        description,
        latitude,
        longitude,
        active === null ? null : active ? 1 : 0,
        settings && JSON.stringify(settings),
        Date.now(),
    );
    return Boolean(row);
}

/** The deleted row, or null if there was none. */
export function deletePlace(db: Db, id: string): Record<string, unknown> | null {
    const row = db.one<PlaceRecord & { active: number; suggestion_id: string | null }>(DELETE_PLACE, id);
    return row ? { ...row, settings: JSON.parse(row.settings) as GeoPlaceSettings, active: row.active === 1 } : null;
}
