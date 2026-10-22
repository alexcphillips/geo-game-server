/** The environment the scripts read (the repo root's `.env`). Nothing else here touches `process.env`. */
export const ENV = {
    NODE_ENV: process.env.NODE_ENV || "development",
    /** The Worker's GEO_OPS_SECRET: its `/geo/ops/*` routes, for geo:admin, wipe:geo and the smoke kit. */
    GEO_OPS_SECRET: process.env.GEO_OPS_SECRET || "",
} as const;

export const IS_PRODUCTION = ENV.NODE_ENV === "production";
