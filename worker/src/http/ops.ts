import type { MiddlewareHandler } from "hono";
import { AppError } from "../../../server/src/http/AppError";
import type { AppEnv } from "../app";

const encoder = new TextEncoder();

/**
 * The operator's routes (`/geo/ops/*`): only with `Authorization: Bearer
 * <GEO_OPS_SECRET>`. Without the secret set, or with a wrong one, they don't
 * exist (404), so nobody can tell them apart from any unknown path.
 */
export const opsOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
    const secret = c.var.world.env.GEO_OPS_SECRET;
    const given = c.req.header("Authorization")?.split(" ")[1] ?? "";
    const [a, b] = [encoder.encode(given), encoder.encode(secret ?? "")];
    if (!secret || a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b)) throw AppError.notFound("Not found");
    await next();
};
