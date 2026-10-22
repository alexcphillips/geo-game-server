import type { Request, Response } from "express";
import {
    distanceMetres,
    GEO_WORLD_HABITAT_METRES,
    GEO_WORLD_HABITATS,
    GEO_WORLD_WATER_KINDS,
    isValidPoint,
    type GeoDevSpawnRequest,
    type GeoPoint,
    type GeoWorldResponse,
    type GeoWorldWaterKind,
} from "@geo/shared";
import { IS_PRODUCTION } from "../../config/env";
import { CONTENT } from "../../content";
import { AppError } from "../../http/AppError";
import { requirePlayerId } from "../../middleware/geo-auth";
import { SPAWN_RULES, type NearPlaces } from "../../world";
import { findPlacesNear } from "../places/geo-places.repository";
import * as worldRepository from "./geo-world.repository";

/**
 * Enemies around the player, placed for them alone; other players are never
 * shown. Of the position, only the latest point is kept, overwritten as they
 * move, to tell walking from sitting (geo/world/travel.ts); the spawns placed
 * near it last minutes, then are deleted.
 */
export async function getWorld(req: Request, res: Response) {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    const here = { latitude, longitude };
    if (!isValidPoint(here)) throw AppError.badRequest("latitude and longitude are required");

    const fill = !IS_PRODUCTION && req.query.fill === "true";
    const near = await nearPlaces(here, req.query);
    res.status(200).json(await worldReply(requirePlayerId(req), here, near, fill));
}

/**
 * The nearest place of each habitat: what the app sees on the map, trusted as
 * sent (only whole, sensible points within GEO_WORLD_HABITAT_METRES; anything
 * else is ignored rather than refused, as places only flavour spawns), and
 * admins' hand-made places, which the server knows itself. The nearer wins.
 */
async function nearPlaces(here: GeoPoint, query: Request["query"]): Promise<NearPlaces> {
    const near: NearPlaces = {};
    const closer = (habitat: keyof NearPlaces, point: GeoPoint) => {
        const distance = distanceMetres(here, point);
        const held = near[habitat];
        return distance <= GEO_WORLD_HABITAT_METRES && (!held || distance < distanceMetres(here, held));
    };

    for (const habitat of GEO_WORLD_HABITATS) {
        const point = { latitude: Number(query[`${habitat}Latitude`]), longitude: Number(query[`${habitat}Longitude`]) };
        if (!isValidPoint(point) || !closer(habitat, point)) continue;
        if (habitat !== "water") {
            near[habitat] = point;
            continue;
        }
        const waterKind = query.waterKind as GeoWorldWaterKind;
        if (GEO_WORLD_WATER_KINDS.includes(waterKind)) near.water = { ...point, waterKind };
    }

    // Hand-made fishing spots don't say what water they're on; the app's own
    // water edge stands in for them.
    for (const place of await findPlacesNear(here, GEO_WORLD_HABITAT_METRES)) {
        if (place.kind !== "fishing" && closer(place.kind, place)) near[place.kind] = { latitude: place.latitude, longitude: place.longitude };
    }
    return near;
}

async function worldReply(playerId: string, here: GeoPoint, near: NearPlaces, fill: boolean): Promise<GeoWorldResponse> {
    return {
        spawns: await worldRepository.spawnsAround(playerId, here, Date.now(), near, fill),
        reachMetres: SPAWN_RULES.reachMetres,
        // Every new spawn lands inside this, a little short of reach.
        spawnRadiusMetres: SPAWN_RULES.maxSpawnMetres,
    };
}

/** Dev servers only: an enemy within reach now, e.g. the test dragon. */
export async function devSpawn(req: Request, res: Response) {
    if (IS_PRODUCTION) throw AppError.notFound("Not found");
    const { enemyId, latitude, longitude } = (req.body ?? {}) as Partial<GeoDevSpawnRequest>;
    const here = { latitude, longitude };
    if (typeof enemyId !== "string" || !CONTENT.enemies[enemyId]) throw AppError.badRequest("Unknown enemy");
    if (!isValidPoint(here)) throw AppError.badRequest("latitude and longitude are required");

    const playerId = requirePlayerId(req);
    await worldRepository.addSpawn(playerId, enemyId, here, Date.now());
    res.status(201).json(await worldReply(playerId, here, {}, false));
}
