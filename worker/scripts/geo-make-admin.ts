import { GEO_OPS_PATHS, ops, workerUrl } from "./ops-client";

/**
 * Makes a geo-game account a game admin: `npm run geo:admin -- you@example.com`.
 * Add `--revoke` to make them a plain player again. Runs on the local Worker
 * (`npm run dev:worker`) unless given `--url <base>`; needs GEO_OPS_SECRET.
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
    const made = await ops<{ displayName: string }>(url, GEO_OPS_PATHS.role, { email, role });
    console.log(`${made.displayName} (${email}) is now: ${role}, on ${url}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
