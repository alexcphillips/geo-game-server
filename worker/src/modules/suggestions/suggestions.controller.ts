import type { Context } from "hono";
import {
    GEO_SUGGESTION_KINDS,
    GEO_SUGGESTION_NOTE_MAX,
    distanceMetres,
    isValidPoint,
    type GeoSuggestionKind,
    type GeoSuggestionRequest,
} from "@geo/shared";
import { AppError } from "../../../../game/src/http/AppError";
import type { AppEnv } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as suggestionsRepository from "./suggestions.repository";

type Ctx = Context<AppEnv>;

const isKind = (kind: unknown): kind is GeoSuggestionKind => GEO_SUGGESTION_KINDS.includes(kind as GeoSuggestionKind);

/**
 * Any player may suggest a place. A far-off pin isn't refused: the distance
 * is stored, and the reviewer decides what it means.
 */
export async function createSuggestion(c: Ctx) {
    const { kind, latitude, longitude, note, player } = (await jsonBody(c)) as Partial<GeoSuggestionRequest>;
    if (!isKind(kind)) throw AppError.badRequest(`kind must be one of ${GEO_SUGGESTION_KINDS.join(", ")}`);
    const target = { latitude, longitude };
    if (!isValidPoint(target)) throw AppError.badRequest("A valid latitude and longitude are needed");
    if (!isValidPoint(player)) throw AppError.badRequest("The player's position is needed");
    if (note !== undefined && typeof note !== "string") throw AppError.badRequest("note must be text");
    const cleanNote = (note ?? "").trim();
    if (cleanNote.length > GEO_SUGGESTION_NOTE_MAX) throw AppError.badRequest(`The note can be at most ${GEO_SUGGESTION_NOTE_MAX} characters`);
    const accuracy =
        typeof player.accuracy === "number" && Number.isFinite(player.accuracy) && player.accuracy >= 0 ? player.accuracy : null;

    const id = suggestionsRepository.insertSuggestion(c.var.world.db, {
        playerId: requirePlayerId(c),
        kind,
        latitude: target.latitude,
        longitude: target.longitude,
        note: cleanNote,
        playerLatitude: player.latitude,
        playerLongitude: player.longitude,
        gpsAccuracy: accuracy,
        distanceMetres: distanceMetres(player, target),
    });
    return c.json({ id }, 201);
}
