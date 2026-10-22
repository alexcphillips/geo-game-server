import type { Context } from "hono";
import type { AppEnv } from "../app";

/** Whether the testing routes answer (`GEO_DEV_TOOLS` in wrangler.jsonc): only while nobody plays here. */
export const devTools = (c: Context<AppEnv>) => c.var.world.env.GEO_DEV_TOOLS === "true";
