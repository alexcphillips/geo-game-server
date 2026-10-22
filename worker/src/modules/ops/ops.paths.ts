/**
 * The operator's routes, behind GEO_OPS_SECRET (http/ops.ts). Not part of the
 * app's API (`@geo/shared`): only the scripts in server/src/dev call them.
 */
export const GEO_OPS_PATHS = {
    /** POST { email, role }: the way to the first admin (`npm run geo:admin`). */
    role: "/geo/ops/role",
    /** POST { confirm? }: every player's progress back to the starter kit (`npm run wipe:geo`). Without confirm, only counts. */
    wipe: "/geo/ops/wipe",
    /** POST { sql, params }: one statement in its own transaction; its rows. Only while GEO_DEV_TOOLS is on (the smoke kit). */
    sql: "/geo/ops/sql",
    /** POST { playerId, items }: items straight into an inventory; the new row ids. Only while GEO_DEV_TOOLS is on. */
    grant: "/geo/ops/grant",
} as const;
