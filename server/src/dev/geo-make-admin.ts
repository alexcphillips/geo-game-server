import { pool } from "../db";
import { ensureGeoSchema } from "../db/geo.schema";
import { GEO_OPS_PATHS, ops, workerUrl } from "./ops-client";

/**
 * Makes a geo-game account a game admin: `npm run geo:admin -- you@example.com`.
 * Add `--revoke` to make them a plain player again, and `--url <base>` to do
 * it on the Cloudflare Worker (needs GEO_OPS_SECRET) instead of Postgres.
 *
 * The way to the first admin; after that, admins can promote others in the
 * app (PUT /geo/admin/players/:playerId/role).
 */
const args = process.argv.slice(2);
const url = workerUrl(args);
const email = args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--url");
const role = args.includes("--revoke") ? "player" : "admin";

if (!email) {
    console.error("Usage: npm run geo:admin -- <email> [--revoke] [--url <base>]");
    process.exit(1);
}

try {
    if (url) {
        const made = await ops<{ displayName: string }>(url, GEO_OPS_PATHS.role, { email, role });
        console.log(`${made.displayName} (${email}) is now: ${role}, on ${url}`);
    } else {
        await ensureGeoSchema();
        const { rows } = await pool.query<{ display_name: string }>(
            `UPDATE geo.players SET role = $2
             WHERE lower(email) = lower($1)
             RETURNING display_name`,
            [email, role],
        );
        if (!rows[0]) {
            console.error(`No geo-game account for ${email}.`);
            process.exitCode = 1;
        } else {
            console.log(`${rows[0].display_name} (${email}) is now: ${role}`);
        }
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
