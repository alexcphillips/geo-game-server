import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "../../../server/src/http/AppError";
import type { AppEnv } from "../app";

type Window = { count: number; resetsAt: number };

/**
 * At most `max` requests per `windowMs` for each caller (their IP, or
 * `key`: after `auth`, the player), counted in the World object's memory:
 * one object serves the game, so the count is exact and costs no database
 * writes. A restart forgets it, which is fine.
 */
export function rateLimit(options: {
    windowMs: number;
    max: number;
    message?: string;
    key?: (c: Context<AppEnv>) => string;
}): MiddlewareHandler<AppEnv> {
    const windows = new Map<string, Window>();
    const message = options.message ?? "Too many attempts. Wait a minute and try again.";

    return async (c, next) => {
        const now = Date.now();
        // Forget finished windows now and then, so the map can't grow forever.
        if (windows.size > 1000) for (const [key, window] of windows) if (window.resetsAt <= now) windows.delete(key);

        const key = options.key?.(c) ?? c.req.header("CF-Connecting-IP") ?? "unknown";
        let window = windows.get(key);
        if (!window || window.resetsAt <= now) {
            window = { count: 0, resetsAt: now + options.windowMs };
            windows.set(key, window);
        }
        window.count += 1;
        if (window.count > options.max) {
            throw AppError.tooManyRequests(message, Math.ceil((window.resetsAt - now) / 1000));
        }
        await next();
    };
}
