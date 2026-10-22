import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "../../../server/src/http/AppError";
import type { AppEnv } from "../app";

const encoder = new TextEncoder();

/**
 * The operator's routes (`/geo/ops/*`): only with `Authorization: Bearer
 * <GEO_OPS_SECRET>`. Without the secret set, or with a wrong one, they don't
 * exist (404), so nobody can tell them apart from any unknown path.
 */
export const opsOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!isOpsSecret(c, c.req.header("Authorization")?.split(" ")[1])) throw AppError.notFound("Not found");
    await next();
};

/** Whether `given` is GEO_OPS_SECRET (and it's set), compared in constant time. */
export function isOpsSecret(c: Context<AppEnv>, given: string | undefined): boolean {
    const secret = c.var.world.env.GEO_OPS_SECRET;
    const [a, b] = [encoder.encode(given ?? ""), encoder.encode(secret ?? "")];
    return Boolean(secret) && a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

/** The smoke kit's header: its calls skip the rate limits while dev tools are on (it signs up many accounts from one address). */
export const OPS_HEADER = "X-Geo-Ops";
