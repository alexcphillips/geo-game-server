import type { NextFunction, Request, Response } from "express";
import { AppError } from "../http/AppError";

type Window = { count: number; resetsAt: number };

/**
 * A small in-memory limiter: at most `max` requests per `windowMs` for each
 * key (by default the caller's IP). Enough for one server at family scale;
 * several servers would need a shared store (Redis, or a table) instead.
 */
export function rateLimit(options: {
    windowMs: number;
    max: number;
    /** What to count by. Defaults to the caller's IP. */
    key?: (req: Request) => string;
    message?: string;
}) {
    const windows = new Map<string, Window>();
    const keyOf = options.key ?? ((req: Request) => req.ip ?? "unknown");
    const message = options.message ?? "Too many attempts. Wait a minute and try again.";

    // Forget finished windows now and then, so the map can't grow forever.
    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [key, window] of windows) if (window.resetsAt <= now) windows.delete(key);
    }, options.windowMs);
    sweep.unref();

    return (req: Request, res: Response, next: NextFunction) => {
        const now = Date.now();
        const key = keyOf(req);
        let window = windows.get(key);
        if (!window || window.resetsAt <= now) {
            window = { count: 0, resetsAt: now + options.windowMs };
            windows.set(key, window);
        }
        window.count += 1;
        if (window.count > options.max) {
            res.setHeader("Retry-After", String(Math.ceil((window.resetsAt - now) / 1000)));
            return next(new AppError(429, message));
        }
        next();
    };
}
