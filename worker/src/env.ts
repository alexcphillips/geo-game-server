import type { World } from "./world";

/** The Worker's bindings (wrangler.jsonc) and secrets. */
export type Env = {
    WORLD: DurableObjectNamespace<World>;
    WORLD_NAME: string;
    /** Signs access tokens. Changing it signs everyone out. */
    GEO_JWT_SECRET: string;
};
