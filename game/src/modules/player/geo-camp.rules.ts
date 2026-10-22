import {
    distanceMetres,
    GEO_DEFEAT_HEALTH_FRACTION,
    GEO_CAMP_DECIMALS,
    GEO_CAMP_MOVE_DAYS,
    GEO_CAMP_RADIUS_METRES,
    type GeoPoint,
} from "@geo/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The point as it's stored: rounded, so the exact spot is never kept. */
export function roundCamp(point: GeoPoint): GeoPoint {
    const round = (value: number) => Number(value.toFixed(GEO_CAMP_DECIMALS));
    return { latitude: round(point.latitude), longitude: round(point.longitude) };
}

export function isAtCamp(position: GeoPoint, camp: GeoPoint | null): boolean {
    return camp !== null && distanceMetres(position, camp) <= GEO_CAMP_RADIUS_METRES;
}

/** When a camp set at `setAt` can be moved; null (never set) is now. */
export function campMovableAt(setAt: Date | null): Date {
    return setAt ? new Date(setAt.getTime() + GEO_CAMP_MOVE_DAYS * DAY_MS) : new Date(0);
}

/** Stored health (NULL is full) against max health right now. */
export function currentHealth(stored: number | null, max: number): number {
    return stored === null ? max : Math.min(stored, max);
}

/** What a lost fight leaves of `max`: rounded up, at least 1. */
export function defeatHealth(max: number): number {
    return Math.max(1, Math.ceil(max * GEO_DEFEAT_HEALTH_FRACTION));
}
