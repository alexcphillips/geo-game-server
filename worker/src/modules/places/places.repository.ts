import { distanceMetres, type GeoPlace, type GeoPlaceKind, type GeoPlaceSettings, type GeoPoint } from "@geo/shared";
import type { Db } from "../../db/db";
import { FIND_ACTIVE_IN_BOX } from "./places.sql.ts";

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
