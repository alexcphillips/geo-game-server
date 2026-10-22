import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async controller so a rejected promise reaches the error middleware
 * instead of hanging the request. Every async handler in `modules/` is wrapped
 * exactly once, at the point it is mounted in `*.routes.ts`.
 */
export function asyncHandler(
    handler: (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => Promise<unknown>,
): RequestHandler {
    return (req, res, next) => {
        handler(req, res, next).catch(next);
    };
}
