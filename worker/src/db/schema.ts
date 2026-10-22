import type { Db } from "./db";

/**
 * The World's tables, as numbered steps. Each runs once, in order, when the
 * World object starts (`schema_migrations` remembers which ran). Add a step;
 * never edit one that has run on the deployed World.
 *
 * Until the game moves here, the deployed World holds only test accounts, so
 * a step can still be edited: change `WORLD_NAME` in wrangler.jsonc and the
 * next deploy starts from an empty database.
 *
 * Writes are the free plan's tightest limit (100k rows a day, and every index
 * entry counts), so each index below says which query needs it.
 *
 * Conventions: ids are TEXT (crypto.randomUUID()), times are INTEGER ms since
 * the epoch, true/false are INTEGER 1/0, JSON is TEXT. Tables keyed by a TEXT
 * id are `WITHOUT ROWID`: the key is the table, so an insert writes one row
 * fewer than a separate primary-key index would.
 */
const MIGRATIONS: string[][] = [
    // 1: accounts.
    [
        `CREATE TABLE players (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL CHECK (length(display_name) <= 40),
            role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
            banned_at INTEGER,
            coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
            bank_coins INTEGER NOT NULL DEFAULT 0 CHECK (bank_coins >= 0),
            talisman_bag_pages INTEGER NOT NULL DEFAULT 1 CHECK (talisman_bag_pages >= 1),
            lunchbox_slots INTEGER NOT NULL DEFAULT 1 CHECK (lunchbox_slots BETWEEN 1 AND 4),
            bait_slots INTEGER NOT NULL DEFAULT 1 CHECK (bait_slots BETWEEN 1 AND 4),
            always_sea_creatures INTEGER NOT NULL DEFAULT 0,
            health INTEGER CHECK (health >= 1),
            inbox_read_at INTEGER,
            created_at INTEGER NOT NULL
        ) STRICT, WITHOUT ROWID;`,
        // Signing in looks up by email; sign-up checks both. Case-insensitive.
        `CREATE UNIQUE INDEX players_email_key ON players (lower(email));`,
        `CREATE UNIQUE INDEX players_display_name_key ON players (lower(display_name));`,

        // Keyed by the token's hash, the only way it's ever looked up: no separate id to index.
        `CREATE TABLE refresh_tokens (
            token_hash TEXT PRIMARY KEY,
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            revoked_at INTEGER
        ) STRICT, WITHOUT ROWID;`,
        // Ending all of a player's sessions (a stolen token, a ban), and the cascade on delete.
        `CREATE INDEX refresh_tokens_player ON refresh_tokens (player_id);`,
    ],
];

export function migrate(db: Db) {
    db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, ran_at INTEGER NOT NULL) STRICT;`);
    const done = db.one<{ version: number | null }>(`SELECT max(version) AS version FROM schema_migrations;`)?.version ?? 0;
    MIGRATIONS.forEach((statements, index) => {
        const version = index + 1;
        if (version <= done) return;
        db.transaction(() => {
            for (const sql of statements) db.run(sql);
            db.run(`INSERT INTO schema_migrations (version, ran_at) VALUES (?, ?);`, version, Date.now());
        });
    });
}
