import type { GeoRole } from "@geo/shared";

declare module "express-serve-static-core" {
    interface Request {
        /** Set by `geoAuth` on geo-game routes only. */
        geoPlayerId?: string;
        /** Set by `geoAuth`, read fresh from the database each request. */
        geoRole?: GeoRole;
    }
}
