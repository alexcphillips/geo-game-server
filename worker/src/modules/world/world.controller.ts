import type { Context } from "hono";
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
import { CONTENT } from "../../../../server/src/content";
import { createRng } from "../../../../server/src/engine/rng";
import { AppError } from "../../../../server/src/http/AppError";
import { rollSpawnCount, SPAWN_RULES, windowAt, type NearPlaces } from "../../../../server/src/world/spawns";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import { secretSeed } from "../../lib/secret-seed";
import { findPlacesNear } from "../places/places.repository";
import * as worldRepository from "./world.repository";

/**
 * Enemies around the player, placed for them alone, from
 * server/src/modules/world/geo-world.controller.ts.
 */

type Ctx = Context<AppEnv>;

const devTools = (c: Ctx) => c.var.world.env.GEO_DEV_TOOLS === "true";

/** How many spawns this player has this window. Secret-seeded: steady within a window, never stored. */
async function windowCountFor(c: Ctx, playerId: string, now: number): Promise<number> {
    const seed = await secretSeed(c.var.world.env.GEO_JWT_SECRET, `spawn-count:${playerId}:${windowAt(now)}`);
    return rollSpawnCount(createRng(seed));
}

export async function getWorld(c: Ctx) {
    const here = { latitude: Number(c.req.query("latitude")), longitude: Number(c.req.query("longitude")) };
    if (!isValidPoint(here)) throw AppError.badRequest("latitude and longitude are required");

    const playerId = requirePlayerId(c);
    const now = Date.now();
    const windowCount = await windowCountFor(c, playerId, now);
    const fill = devTools(c) && c.req.query("fill") === "true";
    const spawns = worldRepository.spawnsAround(c.var.world, playerId, here, now, nearPlaces(c, here), windowCount, fill);
    return c.json(worldReply(spawns), 200);
}

/**
 * The nearest place of each habitat: what the app sees on the map, trusted as
 * sent (only whole, sensible points within GEO_WORLD_HABITAT_METRES; anything
 * else is ignored rather than refused, as places only flavour spawns), and
 * admins' hand-made places, which the server knows itself. The nearer wins.
 */
function nearPlaces(c: Ctx, here: GeoPoint): NearPlaces {
    const near: NearPlaces = {};
    const closer = (habitat: keyof NearPlaces, point: GeoPoint) => {
        const distance = distanceMetres(here, point);
        const held = near[habitat];
        return distance <= GEO_WORLD_HABITAT_METRES && (!held || distance < distanceMetres(here, held));
    };

    for (const habitat of GEO_WORLD_HABITATS) {
        const point = { latitude: Number(c.req.query(`${habitat}Latitude`)), longitude: Number(c.req.query(`${habitat}Longitude`)) };
        if (!isValidPoint(point) || !closer(habitat, point)) continue;
        if (habitat !== "water") {
            near[habitat] = point;
            continue;
        }
        const waterKind = c.req.query("waterKind") as GeoWorldWaterKind;
        if (GEO_WORLD_WATER_KINDS.includes(waterKind)) near.water = { ...point, waterKind };
    }

    // Hand-made fishing spots don't say what water they're on; the app's own
    // water edge stands in for them.
    for (const place of findPlacesNear(c.var.world.db, here, GEO_WORLD_HABITAT_METRES)) {
        if (place.kind !== "fishing" && closer(place.kind, place)) near[place.kind] = { latitude: place.latitude, longitude: place.longitude };
    }
    return near;
}

function worldReply(spawns: GeoWorldResponse["spawns"]): GeoWorldResponse {
    return {
        spawns,
        reachMetres: SPAWN_RULES.reachMetres,
        // Every new spawn lands inside this, a little short of reach.
        spawnRadiusMetres: SPAWN_RULES.maxSpawnMetres,
    };
}

/** Dev tools only (GEO_DEV_TOOLS): an enemy within reach now, e.g. the test dragon. */
export async function devSpawn(c: Ctx) {
    if (!devTools(c)) throw AppError.notFound("Not found");
    const { enemyId, latitude, longitude } = (await jsonBody(c)) as Partial<GeoDevSpawnRequest>;
    const here = { latitude, longitude };
    if (typeof enemyId !== "string" || !CONTENT.enemies[enemyId]) throw AppError.badRequest("Unknown enemy");
    if (!isValidPoint(here)) throw AppError.badRequest("latitude and longitude are required");

    const playerId = requirePlayerId(c);
    const now = Date.now();
    const { world } = c.var;
    world.db.transaction(() => worldRepository.addSpawn(world.db, playerId, enemyId, here, now));
    const windowCount = await windowCountFor(c, playerId, now);
    return c.json(worldReply(worldRepository.spawnsAround(world, playerId, here, now, {}, windowCount)), 201);
}
