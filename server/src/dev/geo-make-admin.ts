import { pool } from "../db";
import { ensureGeoSchema } from "../db/geo.schema";

/**
 * Makes a geo-game account a game admin: `npm run geo:admin -- you@example.com`.
 * Add `--revoke` to make them a plain player again.
 *
 * The way to the first admin; after that, admins can promote others in the
 * app (PUT /geo/admin/players/:playerId/role).
 */
const args = process.argv.slice(2);
const email = args.find((arg) => !arg.startsWith("--"));
const role = args.includes("--revoke") ? "player" : "admin";

if (!email) {
    console.error("Usage: npm run geo:admin -- <email> [--revoke]");
    process.exit(1);
}

try {
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
} finally {
    await pool.end();
}
