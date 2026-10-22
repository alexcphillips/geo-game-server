import type { Request, Response } from "express";
import {
    GEO_FISHING_TIERS,
    GEO_FISHING_WATERS,
    GEO_PLACE_DESCRIPTION_MAX,
    GEO_PLACE_KINDS,
    GEO_PLACE_NAME_MAX,
    GEO_PLACES_RADIUS_METRES,
    isValidPoint,
    type GeoAdminCreatePlaceRequest,
    type GeoAdminPlacesResponse,
    type GeoAdminUpdatePlaceRequest,
    type GeoFishingTier,
    type GeoFishingWater,
    type GeoPlaceKind,
    type GeoPlaceSettings,
    type GeoPlacesResponse,
} from "@geo/shared";
import { AppError } from "../../http/AppError";
import { withTransaction } from "../../db/transaction";
import { requirePlayerId } from "../../middleware/geo-auth";
import { isUuid } from "../../lib/validate";
import * as adminRepository from "../admin/geo-admin.repository";
import * as suggestionsRepository from "../suggestions/geo-suggestions.repository";
import * as placesRepository from "./geo-places.repository";
import type { PlaceChanges } from "./geo-places.types";


function isKind(kind: unknown): kind is GeoPlaceKind {
    return GEO_PLACE_KINDS.includes(kind as GeoPlaceKind);
}

function placeId(req: Request): string {
    const id = String(req.params.placeId ?? "");
    if (!isUuid(id)) throw AppError.badRequest("Bad place id");
    return id;
}

/** Optional: an empty name leaves the app to call the place by its type. */
function cleanName(name: unknown): string {
    if (typeof name !== "string") throw AppError.badRequest("name must be text");
    if (name.trim().length > GEO_PLACE_NAME_MAX) {
        throw AppError.badRequest(`The name can be at most ${GEO_PLACE_NAME_MAX} characters`);
    }
    return name.trim();
}

function cleanDescription(description: unknown): string {
    if (typeof description !== "string") throw AppError.badRequest("description must be text");
    if (description.trim().length > GEO_PLACE_DESCRIPTION_MAX) {
        throw AppError.badRequest(`The description can be at most ${GEO_PLACE_DESCRIPTION_MAX} characters`);
    }
    return description.trim();
}

/**
 * A place's settings, checked for its kind. Only that kind's section is kept,
 * so a place that stops being a fishing spot drops its fishing settings.
 */
function cleanSettings(kind: GeoPlaceKind, settings: unknown): GeoPlaceSettings {
    if (settings === undefined || settings === null) return {};
    if (typeof settings !== "object" || Array.isArray(settings)) throw AppError.badRequest("settings must be an object");
    const { fishing } = settings as Record<string, unknown>;
    if (kind !== "fishing" || fishing === undefined || fishing === null) return {};
    if (typeof fishing !== "object" || Array.isArray(fishing)) throw AppError.badRequest("settings.fishing must be an object");
    const { tier, water } = fishing as Record<string, unknown>;
    if (tier !== undefined && !GEO_FISHING_TIERS.includes(tier as GeoFishingTier)) {
        throw AppError.badRequest(`The fishing tier must be one of ${GEO_FISHING_TIERS.join(", ")}`);
    }
    if (water !== undefined && !GEO_FISHING_WATERS.includes(water as GeoFishingWater)) {
        throw AppError.badRequest(`The water must be one of ${GEO_FISHING_WATERS.join(", ")}`);
    }
    const clean: NonNullable<GeoPlaceSettings["fishing"]> = {};
    if (tier !== undefined) clean.tier = tier as GeoFishingTier;
    if (water !== undefined) clean.water = water as GeoFishingWater;
    return { fishing: clean };
}

/**
 * Hand-made places around the player, for the map to draw beside the tile
 * places. Static data, so the app fetches it far less often than spawns.
 */
export async function listPlacesNear(req: Request, res: Response) {
    const here = { latitude: Number(req.query.latitude), longitude: Number(req.query.longitude) };
    if (!isValidPoint(here)) throw AppError.badRequest("latitude and longitude are required");
    const body: GeoPlacesResponse = {
        places: await placesRepository.findPlacesNear(here, GEO_PLACES_RADIUS_METRES),
        radiusMetres: GEO_PLACES_RADIUS_METRES,
    };
    res.status(200).json(body);
}

export async function listPlaces(_req: Request, res: Response) {
    const body: GeoAdminPlacesResponse = { places: await placesRepository.findPlaces() };
    res.status(200).json(body);
}

/** Makes a place; from a suggestion, that suggestion is linked and accepted too. */
export async function createPlace(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const { kind, name, description, latitude, longitude, settings, suggestionId } = (req.body ?? {}) as Partial<GeoAdminCreatePlaceRequest>;
    if (!isKind(kind)) throw AppError.badRequest(`kind must be one of ${GEO_PLACE_KINDS.join(", ")}`);
    const point = { latitude, longitude };
    if (!isValidPoint(point)) throw AppError.badRequest("A valid latitude and longitude are needed");
    if (suggestionId !== undefined && !isUuid(suggestionId)) {
        throw AppError.badRequest("Bad suggestion id");
    }
    const place = {
        kind,
        name: name === undefined ? "" : cleanName(name),
        description: description === undefined ? "" : cleanDescription(description),
        latitude: point.latitude,
        longitude: point.longitude,
        settings: cleanSettings(kind, settings),
        createdBy: adminId,
        suggestionId: suggestionId ?? null,
    };

    const id = await withTransaction(async (tx) => {
        if (place.suggestionId && !(await suggestionsRepository.acceptForPlace(tx, place.suggestionId, adminId))) {
            throw AppError.notFound("Suggestion not found");
        }
        let newId: string;
        try {
            newId = await placesRepository.insertPlace(tx, place);
        } catch (error) {
            if ((error as { code?: string }).code !== "23505") throw error;
            throw new AppError(409, "That suggestion already has a place");
        }
        await adminRepository.audit(tx, adminId, "create-place", newId, place);
        return newId;
    });
    res.status(201).json(await placesRepository.findPlace(id));
}

/** Edits, moves, or (de)activates a place: only the fields sent change. */
export async function updatePlace(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const id = placeId(req);
    const body = (req.body ?? {}) as Partial<Record<keyof GeoAdminUpdatePlaceRequest, unknown>>;

    const changes: PlaceChanges = {
        kind: null,
        name: null,
        description: null,
        latitude: null,
        longitude: null,
        active: null,
        settings: null,
    };
    if (body.kind !== undefined) {
        if (!isKind(body.kind)) throw AppError.badRequest(`kind must be one of ${GEO_PLACE_KINDS.join(", ")}`);
        changes.kind = body.kind;
    }
    if (body.name !== undefined) changes.name = cleanName(body.name);
    if (body.description !== undefined) changes.description = cleanDescription(body.description);
    if (body.latitude !== undefined || body.longitude !== undefined) {
        const point = { latitude: body.latitude, longitude: body.longitude };
        if (!isValidPoint(point)) throw AppError.badRequest("Moving needs a valid latitude and longitude together");
        changes.latitude = point.latitude;
        changes.longitude = point.longitude;
    }
    if (body.active !== undefined) {
        if (typeof body.active !== "boolean") throw AppError.badRequest("active must be true or false");
        changes.active = body.active;
    }
    // Settings are checked against the kind the place will have; a new kind
    // re-checks the settings it already has.
    if (body.settings !== undefined || changes.kind !== null) {
        const current = await placesRepository.findPlace(id);
        if (!current) throw AppError.notFound("Place not found");
        changes.settings = cleanSettings(changes.kind ?? current.kind, body.settings ?? current.settings);
    }
    if (Object.values(changes).every((value) => value === null)) throw AppError.badRequest("Nothing to change");

    await withTransaction(async (tx) => {
        if (!(await placesRepository.updatePlace(tx, id, changes))) throw AppError.notFound("Place not found");
        await adminRepository.audit(tx, adminId, "update-place", id, changes);
    });
    res.status(200).json(await placesRepository.findPlace(id));
}

/** Removes a place for good. The audit keeps what it was. */
export async function deletePlace(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const id = placeId(req);
    await withTransaction(async (tx) => {
        const removed = await placesRepository.deletePlace(tx, id);
        if (!removed) throw AppError.notFound("Place not found");
        await adminRepository.audit(tx, adminId, "delete-place", id, removed);
    });
    res.status(204).end();
}
