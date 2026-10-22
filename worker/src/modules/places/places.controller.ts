import type { Context } from "hono";
import { GEO_PLACES_RADIUS_METRES, isValidPoint, type GeoPlacesResponse } from "@geo/shared";
import { AppError } from "../../../../server/src/http/AppError";
import type { AppEnv } from "../../app";
import * as placesRepository from "./places.repository";

/**
 * Hand-made places around the player, for the map to draw beside the tile
 * places. Static data, so the app fetches it far less often than spawns.
 */
export function listPlacesNear(c: Context<AppEnv>) {
    const here = { latitude: Number(c.req.query("latitude")), longitude: Number(c.req.query("longitude")) };
    if (!isValidPoint(here)) throw AppError.badRequest("latitude and longitude are required");
    const body: GeoPlacesResponse = {
        places: placesRepository.findPlacesNear(c.var.world.db, here, GEO_PLACES_RADIUS_METRES),
        radiusMetres: GEO_PLACES_RADIUS_METRES,
    };
    return c.json(body, 200);
}
