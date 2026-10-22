import { IS_PRODUCTION } from "../config/env";
import { pool } from "../db";
import { ensureGeoSchema } from "../db/geo.schema";
import { withTransaction } from "../db/transaction";
import { grantStarterKit } from "../modules/accounts/geo-accounts.repository";

/**
 * Wipes every player's progress back to a fresh start, keeping their account:
 * email, password, name, role, ban, sessions, friends and inbox stay.
 * Everything earned goes (items, hands, lunchbox, bait, seeds, farm, contest scores, camp, XP, coins, Runs,
 * Market, chests, travel, dungeon lobbies, quests), then each player gets the starter kit again, as
 * if they'd just signed up. World content (places, suggestions, elections,
 * announcements, feedback) is untouched.
 *
 * Dev only: there's no production game yet, so content changes (a card
 * turned into an item) are rolled out by wiping instead of migrating.
 *
 *     npm run wipe:geo            # shows what it would delete
 *     npm run wipe:geo -- --yes   # wipes
 */
if (IS_PRODUCTION) throw new Error("geo-wipe refuses to run in production");

/** Player progress, children before parents so no row is left pointing at a deleted one. */
const PROGRESS_TABLES = [
    "player_quests",
    "dungeon_lobby_members",
    "dungeon_lobbies",
    "market_sales",
    "market_bids",
    "market_listings",
    "chest_selections",
    "runs",
    "dungeon_run_members",
    "dungeon_runs",
    "spawns",
    "player_travel",
    "coin_ledger",
    "saved_hands",
    "loadouts",
    "hands",
    "lunchbox",
    "bait",
    "farm_contest_scores",
    "farms",
    "talisman_bag",
    "active_pets",
    "pet_upgrades",
    "equipment",
    "inventory",
    "skill_xp",
];

async function main() {
    const confirmed = process.argv.includes("--yes");
    await ensureGeoSchema();

    const counts = await Promise.all(
        PROGRESS_TABLES.map(async (table) => {
            const { rows } = await pool.query<{ n: string }>(
                `SELECT count(*) AS n FROM geo.${table}`,
            );
            return `${table}: ${rows[0]!.n}`;
        }),
    );
    const { rows: players } = await pool.query<{ id: string }>(
        `SELECT id FROM geo.players ORDER BY created_at`,
    );
    console.log(
        `${players.length} accounts kept. Rows to delete:\n  ${counts.join("\n  ")}`,
    );
    if (!confirmed) {
        console.log("\nDry run. Pass --yes to wipe.");
        return;
    }

    await withTransaction(async (tx) => {
        await tx(
            `TRUNCATE ${PROGRESS_TABLES.map((table) => `geo.${table}`).join(", ")}`,
        );
        await tx(`UPDATE geo.players SET coins = 0, bank_coins = 0, wardrobe_bought = 0, active_loadout = NULL, talisman_bag_pages = 1, lunchbox_slots = 1, bait_slots = 1, health = NULL,
            camp_latitude = NULL, camp_longitude = NULL, camp_set_at = NULL`);
        for (const { id } of players) await grantStarterKit(tx, id);
    });
    console.log(
        `\nWiped. ${players.length} accounts start fresh with the starter kit.`,
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
