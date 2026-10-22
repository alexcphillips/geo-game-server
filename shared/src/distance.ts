export type GeoPoint = { latitude: number; longitude: number };

/**
 * Great-circle distance in metres. Plenty accurate at walking distances; the
 * same function on both sides, so "in reach" means the same to app and server.
 */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
    const toRad = (degrees: number) => (degrees * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function isValidPoint(point: unknown): point is GeoPoint {
    if (typeof point !== "object" || point === null) return false;
    const { latitude, longitude } = point as Record<string, unknown>;
    return (
        typeof latitude === "number" &&
        typeof longitude === "number" &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180
    );
}
