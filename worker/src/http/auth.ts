import type { Context, MiddlewareHandler } from "hono";
import type { GeoRole } from "@geo/shared";
import { AppError } from "../../../server/src/http/AppError";
import type { AppEnv } from "../app";
import { verifyAccessToken } from "../lib/tokens";

/** Who a request is from; read per request, so a ban or a role change counts at once. */
const FIND_ACCESS = `SELECT role, banned_at FROM players WHERE id = ?;`;

/**
 * Sets `playerId` and `role` from a geo-game bearer token, or rejects. One
 * primary-key read a request. Playing over HTTP counts as being here
 * (World memory, no write): turn clocks and dungeon holds read it.
 */
export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) throw AppError.unauthorized("Missing token");

    let playerId: string;
    try {
        playerId = (await verifyAccessToken(c.var.world.env.GEO_JWT_SECRET, token)).playerId;
    } catch {
        throw AppError.unauthorized("Invalid token");
    }

    const { world } = c.var;
    const row = world.db.one<{ role: GeoRole; banned_at: number | null }>(FIND_ACCESS, playerId);
    if (!row) throw AppError.unauthorized("Invalid token");
    if (row.banned_at !== null) throw AppError.forbidden("This account has been suspended");
    world.lastHeard.set(playerId, Date.now());
    c.set("playerId", playerId);
    c.set("role", row.role);
    await next();
};

/** After `auth`: game admins only. */
export const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.var.role !== "admin") throw AppError.forbidden("Admin access required");
    await next();
};

/** For controllers behind `auth`. */
export function requirePlayerId(c: Context<AppEnv>): string {
    const id = c.var.playerId;
    if (!id) throw AppError.unauthorized("Missing token");
    return id;
}
