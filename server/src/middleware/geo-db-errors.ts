import type { ErrorRequestHandler } from "express";
import { AppError } from "../http/AppError";

/** Postgres: a value that isn't the column's type, e.g. "abc" for a UUID. */
const INVALID_TEXT_REPRESENTATION = "22P02";

/**
 * Turns database errors a player can cause into a 400, rather than a 500 that
 * carries the SQL error. Ids from a path or a body (a run, a listing, an
 * inventory row) go to UUID columns unchecked, so a malformed one lands here.
 * Mounted last on the geo router, so it only sees geo's errors.
 */
export const geoDbErrors: ErrorRequestHandler = (err, _req, _res, next) => {
    if ((err as { code?: unknown } | null)?.code === INVALID_TEXT_REPRESENTATION) {
        return next(AppError.badRequest("That id isn't valid"));
    }
    next(err);
};
