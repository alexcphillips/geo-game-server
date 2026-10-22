function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
    return value;
}

function optional(name: string, fallback: string): string {
    return process.env[name] || fallback;
}

/**
 * Every environment variable the server reads, resolved and validated once at
 * import time. Nothing else may touch `process.env`: a new setting goes here,
 * so a misconfigured deploy fails at boot rather than on some later request.
 */
export const ENV = {
    PORT: Number(optional("PORT", "3001")),
    NODE_ENV: optional("NODE_ENV", "development"),

    DB: {
        USER: optional("DB_USER", "postgres"),
        HOST: optional("DB_HOST", "localhost"),
        NAME: optional("DB_NAME", "cozy_apps"),
        PASSWORD: required("DB_PASSWORD"),
        PORT: Number(optional("DB_PORT", "5432")),
    },

    /** Signs tokens and seeds spawns. Changing it signs everyone out and reshuffles spawns. */
    GEO_JWT_SECRET: required("GEO_JWT_SECRET"),

    /**
     * The operator's key to the Worker's `/geo/ops/*` (its GEO_OPS_SECRET),
     * for the dev scripts run with `--url`: geo:admin, wipe:geo, the smoke kit.
     */
    GEO_OPS_SECRET: optional("GEO_OPS_SECRET", ""),

    /** Browser origins allowed to call this API (the app itself is native and needs none). */
    CORS_ORIGINS: optional("CORS_ORIGINS", "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
} as const;

export const IS_PRODUCTION = ENV.NODE_ENV === "production";
