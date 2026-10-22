import type { Context } from "hono";
import {
    GEO_FISHING_TIERS,
    GEO_FISHING_WATERS,
    GEO_PLACE_DESCRIPTION_MAX,
    GEO_PLACE_KINDS,
    GEO_PLACE_NAME_MAX,
    isValidPoint,
    type GeoAdminCreatePlaceRequest,
    type GeoAdminPlacesResponse,
    type GeoAdminUpdatePlaceRequest,
    type GeoFishingTier,
    type GeoFishingWater,
    type GeoPlaceKind,
    type GeoPlaceSettings,
} from "@geo/shared";
import { AppError } from "../../../../game/src/http/AppError";
import type { PlaceChanges } from "../../../../game/src/modules/places/geo-places.types";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import { audit } from "../admin/admin.repository";
import { acceptForPlace } from "../suggestions/suggestions.repository";
import * as placesRepository from "./places.repository";

/**
 * Admins making, editing and removing places, every change audited.
 */

type Ctx = Context<AppEnv>;

const isKind = (kind: unknown): kind is GeoPlaceKind => GEO_PLACE_KINDS.includes(kind as GeoPlaceKind);

/** Optional: an empty name leaves the app to call the place by its type. */
function cleanName(name: unknown): string {
    if (typeof name !== "string") throw AppError.badRequest("name must be text");
    if (name.trim().length > GEO_PLACE_NAME_MAX) throw AppError.badRequest(`The name can be at most ${GEO_PLACE_NAME_MAX} characters`);
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

export function listPlaces(c: Ctx) {
    const body: GeoAdminPlacesResponse = { places: placesRepository.findPlaces(c.var.world.db) };
    return c.json(body, 200);
}

/** Makes a place; from a suggestion, that suggestion is linked and accepted too. */
export async function createPlace(c: Ctx) {
    const { kind, name, description, latitude, longitude, settings, suggestionId } = (await jsonBody(c)) as Partial<GeoAdminCreatePlaceRequest>;
    if (!isKind(kind)) throw AppError.badRequest(`kind must be one of ${GEO_PLACE_KINDS.join(", ")}`);
    const point = { latitude, longitude };
    if (!isValidPoint(point)) throw AppError.badRequest("A valid latitude and longitude are needed");
    if (suggestionId !== undefined && typeof suggestionId !== "string") throw AppError.badRequest("Bad suggestion id");
    const adminId = requirePlayerId(c);
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

    const { db } = c.var.world;
    const created = db.transaction(() => {
        if (place.suggestionId) {
            if (!acceptForPlace(db, place.suggestionId, adminId)) throw AppError.notFound("Suggestion not found");
            if (placesRepository.suggestionHasPlace(db, place.suggestionId)) throw new AppError(409, "That suggestion already has a place");
        }
        const id = placesRepository.insertPlace(db, place);
        audit(db, adminId, "create-place", id, place);
        return placesRepository.findPlace(db, id);
    });
    return c.json(created, 201);
}

/** Edits, moves, or (de)activates a place: only the fields sent change. */
export async function updatePlace(c: Ctx) {
    const body = (await jsonBody(c)) as Partial<Record<keyof GeoAdminUpdatePlaceRequest, unknown>>;
    const adminId = requirePlayerId(c);
    const id = c.req.param("placeId") ?? "";
    const { db } = c.var.world;

    const changes: PlaceChanges = { kind: null, name: null, description: null, latitude: null, longitude: null, active: null, settings: null };
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

    const updated = db.transaction(() => {
        // Settings are checked against the kind the place will have; a new kind
        // re-checks the settings it already has.
        if (body.settings !== undefined || changes.kind !== null) {
            const current = placesRepository.findPlace(db, id);
            if (!current) throw AppError.notFound("Place not found");
            changes.settings = cleanSettings(changes.kind ?? current.kind, body.settings ?? current.settings);
        }
        if (Object.values(changes).every((value) => value === null)) throw AppError.badRequest("Nothing to change");
        if (!placesRepository.updatePlace(db, id, changes)) throw AppError.notFound("Place not found");
        audit(db, adminId, "update-place", id, changes);
        return placesRepository.findPlace(db, id);
    });
    return c.json(updated, 200);
}

/** Removes a place for good. The audit keeps what it was. */
export function deletePlace(c: Ctx) {
    const adminId = requirePlayerId(c);
    const id = c.req.param("placeId") ?? "";
    const { db } = c.var.world;
    db.transaction(() => {
        const removed = placesRepository.deletePlace(db, id);
        if (!removed) throw AppError.notFound("Place not found");
        audit(db, adminId, "delete-place", id, removed);
    });
    return c.body(null, 204);
}
