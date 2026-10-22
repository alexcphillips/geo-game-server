import type { World } from "./world";

/** The Worker's bindings (wrangler.jsonc) and secrets. */
export type Env = {
    WORLD: DurableObjectNamespace<World>;
    WORLD_NAME: string;
    /** Signs access tokens. Changing it signs everyone out. */
    GEO_JWT_SECRET: string;
    /** "true" turns on the testing routes (`/geo/dev/*`, `?fill=true`). Off once the game moves here. */
    GEO_DEV_TOOLS?: string;
    /**
     * Unlocks `/geo/ops/*` for the operator's scripts (first admin, wipe,
     * the smoke kit): `Authorization: Bearer <secret>`. Unset, they answer 404.
     */
    GEO_OPS_SECRET?: string;
};
