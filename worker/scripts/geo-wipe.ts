import { IS_PRODUCTION } from "./env";
import { GEO_OPS_PATHS, ops, workerUrl } from "./ops-client";

/**
 * Wipes every player's progress back to a fresh start, keeping their account:
 * email, password, name, role, ban, sessions, friends and inbox stay.
 * Everything earned goes (items, hands, lunchbox, bait, seeds, farm, contest scores, camp, XP, coins, Runs,
 * Market, chests, travel, dungeon lobbies, quests), then each player gets the starter kit again, as
 * if they'd just signed up. World content (places, suggestions, elections,
 * announcements, feedback) is untouched. The World does it (`POST /geo/ops/wipe`).
 *
 * Dev only: there's no production game yet, so content changes (a card
 * turned into an item) are rolled out by wiping instead of migrating.
 *
 *     npm run wipe:geo            # shows what it would delete
 *     npm run wipe:geo -- --yes   # wipes
 *
 * Runs on the local Worker (`npm run dev:worker`) unless given `--url <base>`;
 * needs GEO_OPS_SECRET.
 */
if (IS_PRODUCTION) throw new Error("geo-wipe refuses to run in production");

async function main() {
    const confirmed = process.argv.includes("--yes");
    const url = workerUrl();
    const result = await ops<{ accounts: number; rows: Record<string, number>; wiped: boolean }>(url, GEO_OPS_PATHS.wipe, { confirm: confirmed });
    const counts = Object.entries(result.rows).map(([table, n]) => `${table}: ${n}`);
    console.log(`${url}: ${result.accounts} accounts kept. Rows ${result.wiped ? "deleted" : "to delete"}:\n  ${counts.join("\n  ")}`);
    console.log(result.wiped ? `\nWiped. ${result.accounts} accounts start fresh with the starter kit.` : "\nDry run. Pass --yes to wipe.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
