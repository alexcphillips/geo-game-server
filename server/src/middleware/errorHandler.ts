import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../http/AppError";
import { IS_PRODUCTION } from "../config/env";

/** Terminal 404 for any path no router claimed. Mount after all routes. */
export const notFoundHandler: RequestHandler = (req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
};

/**
 * The single place an error becomes a response. Anything that is not an
 * {@link AppError} is treated as a bug: logged in full, reported as a bare 500
 * so internals (SQL text, stack traces) never reach the client.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
        res.status(err.status).json({ error: err.message });
        return;
    }

    console.error("Unhandled error:", err);

    res.status(500).json({
        error: IS_PRODUCTION
            ? "Internal server error"
            : err instanceof Error
              ? err.message
              : String(err),
    });
};
