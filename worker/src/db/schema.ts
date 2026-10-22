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

    // 2: the rest of the game, translated from server/src/db/geo.schema.ts
    // (read its comments for what each table means). Left out on purpose:
    // presence (last_seen_at, activity: the socket hub's), player_travel and spawns'
    // out_of_reach_since live in World memory; the Market's refund-on-delete
    // trigger comes with the Market.
    //
    // Per-player tables are keyed (player_id, …) so one primary key serves
    // every "this player's rows" query with no index of its own. Gear,
    // the bag and the active pet point at inventory by (player_id, id), so a
    // copy leaving the inventory takes them with it. Tables with big JSON
    // rows (runs, farms, dungeon maps) keep a rowid: SQLite stores large rows
    // badly in WITHOUT ROWID tables.
    //
    // Indexes are only for queries the code runs. A column that just points
    // at players gets none: the cascade when a player is deleted (an admin's
    // rare act) can scan, rather than every insert paying for an index.
    [
        `ALTER TABLE players ADD COLUMN camp_latitude REAL;`,
        `ALTER TABLE players ADD COLUMN camp_longitude REAL;`,
        `ALTER TABLE players ADD COLUMN camp_set_at INTEGER;`,
        `ALTER TABLE players ADD COLUMN wardrobe_bought INTEGER NOT NULL DEFAULT 0 CHECK (wardrobe_bought >= 0);`,
        `ALTER TABLE players ADD COLUMN active_loadout INTEGER;`,

        // `pet` is a pet copy's JSON { xp, heldItem }; NULL for anything else.
        `CREATE TABLE inventory (
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
            charges_left INTEGER CHECK (charges_left >= 0),
            reforge TEXT,
            pet TEXT,
            obtained_at INTEGER NOT NULL,
            PRIMARY KEY (player_id, id)
        ) STRICT, WITHOUT ROWID;`,
        `CREATE TABLE equipment (
            player_id TEXT NOT NULL,
            slot TEXT NOT NULL,
            inventory_id TEXT NOT NULL,
            PRIMARY KEY (player_id, slot),
            FOREIGN KEY (player_id, inventory_id) REFERENCES inventory(player_id, id) ON DELETE CASCADE
        ) STRICT, WITHOUT ROWID;`,
        `CREATE TABLE talisman_bag (
            player_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            inventory_id TEXT NOT NULL,
            PRIMARY KEY (player_id, item_id),
            FOREIGN KEY (player_id, inventory_id) REFERENCES inventory(player_id, id) ON DELETE CASCADE
        ) STRICT, WITHOUT ROWID;`,
        `CREATE TABLE active_pets (
            player_id TEXT PRIMARY KEY,
            inventory_id TEXT NOT NULL,
            FOREIGN KEY (player_id, inventory_id) REFERENCES inventory(player_id, id) ON DELETE CASCADE
        ) STRICT, WITHOUT ROWID;`,
        `CREATE TABLE pet_upgrades (
            player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
            inventory_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            to_item_id TEXT NOT NULL,
            pet TEXT NOT NULL,
            obtained_at INTEGER NOT NULL,
            ready_at INTEGER NOT NULL
        ) STRICT, WITHOUT ROWID;`,

        // `equipment` is JSON { slot: inventory id }; no foreign keys, as in Postgres.
        `CREATE TABLE loadouts (
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            slot INTEGER NOT NULL CHECK (slot >= 0),
            name TEXT NOT NULL CHECK (length(name) <= 20),
            equipment TEXT NOT NULL DEFAULT '{}',
            pet_id TEXT,
            auto_for TEXT CHECK (auto_for IN ('combat', 'fishing')),
            PRIMARY KEY (player_id, slot)
        ) STRICT, WITHOUT ROWID;`,
        // One loadout per activity. Only tagged rows are in it.
        `CREATE UNIQUE INDEX loadouts_auto_for ON loadouts (player_id, auto_for) WHERE auto_for IS NOT NULL;`,

        // inventory_ids: a JSON array, in hand order.
        `CREATE TABLE hands (
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            skill TEXT NOT NULL,
            inventory_ids TEXT NOT NULL DEFAULT '[]',
            PRIMARY KEY (player_id, skill)
        ) STRICT, WITHOUT ROWID;`,
        `CREATE TABLE saved_hands (
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            id TEXT NOT NULL,
            skill TEXT NOT NULL,
            name TEXT NOT NULL CHECK (length(name) <= 40),
            inventory_ids TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (player_id, id)
        ) STRICT, WITHOUT ROWID;`,

        `CREATE TABLE lunchbox (
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 4),
            item_id TEXT NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            PRIMARY KEY (player_id, slot)
        ) STRICT, WITHOUT ROWID;`,
        // One slot per food. Eating only changes quantity, which this index doesn't hold.
        `CREATE UNIQUE INDEX lunchbox_one_slot_per_food ON lunchbox (player_id, item_id);`,
        `CREATE TABLE bait (
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 4),
            item_id TEXT NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            PRIMARY KEY (player_id, slot)
        ) STRICT, WITHOUT ROWID;`,
        `CREATE UNIQUE INDEX bait_one_slot_per_bait ON bait (player_id, item_id);`,

        `CREATE TABLE skill_xp (
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            skill TEXT NOT NULL,
            xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
            PRIMARY KEY (player_id, skill)
        ) STRICT, WITHOUT ROWID;`,

        // Each player's spawns: a row written when one appears, is beaten or
        // goes. When the player walked out of reach is kept in World memory.
        `CREATE TABLE spawns (
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            id TEXT NOT NULL,
            enemy_id TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            despawns_at INTEGER NOT NULL,
            claimed_at INTEGER,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (player_id, id)
        ) STRICT, WITHOUT ROWID;`,

        // Dungeon lobbies and maps come before runs, which point at them.
        `CREATE TABLE dungeon_lobbies (
            id TEXT PRIMARY KEY,
            dungeon_id TEXT NOT NULL,
            host_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            required_level INTEGER NOT NULL CHECK (required_level >= 0),
            max_players INTEGER NOT NULL CHECK (max_players >= 1),
            created_at INTEGER NOT NULL,
            started_at INTEGER,
            closed_at INTEGER
        ) STRICT, WITHOUT ROWID;`,
        `CREATE INDEX dungeon_lobbies_open ON dungeon_lobbies (created_at) WHERE closed_at IS NULL AND started_at IS NULL;`,
        `CREATE TABLE dungeon_lobby_members (
            lobby_id TEXT NOT NULL REFERENCES dungeon_lobbies(id) ON DELETE CASCADE,
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            joined_at INTEGER NOT NULL,
            PRIMARY KEY (lobby_id, player_id)
        ) STRICT, WITHOUT ROWID;`,
        `CREATE INDEX dungeon_lobby_members_player ON dungeon_lobby_members (player_id);`,
        `CREATE TABLE dungeon_runs (
            id TEXT PRIMARY KEY,
            dungeon_id TEXT NOT NULL,
            lobby_id TEXT REFERENCES dungeon_lobbies(id) ON DELETE SET NULL,
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'failed')),
            map TEXT NOT NULL,
            state TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            wake_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            ended_at INTEGER
        ) STRICT;`,
        `CREATE INDEX dungeon_runs_wake ON dungeon_runs (wake_at) WHERE status = 'active';`,
        `CREATE INDEX dungeon_runs_lobby ON dungeon_runs (lobby_id) WHERE lobby_id IS NOT NULL;`,
        `CREATE TABLE dungeon_run_members (
            dungeon_run_id TEXT NOT NULL REFERENCES dungeon_runs(id) ON DELETE CASCADE,
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'failed')),
            state TEXT NOT NULL,
            seat INTEGER NOT NULL,
            ended_at INTEGER,
            PRIMARY KEY (dungeon_run_id, player_id)
        ) STRICT;`,
        `CREATE UNIQUE INDEX dungeon_run_members_one_active ON dungeon_run_members (player_id) WHERE status = 'active';`,

        // A Run's whole battle lives in `state` between turns. enemy_ids: a JSON array.
        `CREATE TABLE runs (
            id TEXT PRIMARY KEY,
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            enemy_ids TEXT NOT NULL DEFAULT '[]',
            state TEXT NOT NULL,
            rewards TEXT,
            spawn_id TEXT,
            coins_lost INTEGER,
            keeps_health INTEGER NOT NULL DEFAULT 0,
            dungeon_id TEXT,
            dungeon_run_id TEXT REFERENCES dungeon_runs(id) ON DELETE CASCADE,
            dungeon_room INTEGER,
            battle_id TEXT,
            combatant_id TEXT,
            turn_started_at INTEGER,
            turn_deadline INTEGER,
            version INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            ended_at INTEGER
        ) STRICT;`,
        // At most one Run in progress per player; also how the live one is found.
        `CREATE UNIQUE INDEX runs_one_active ON runs (player_id) WHERE status = 'active';`,
        // Narrowed to shared fights in step 4.
        `CREATE INDEX runs_player ON runs (player_id, created_at);`,
        `CREATE INDEX runs_battle ON runs (battle_id) WHERE battle_id IS NOT NULL;`,
        `CREATE INDEX runs_dungeon_run ON runs (dungeon_run_id) WHERE dungeon_run_id IS NOT NULL;`,

        // Every coin movement. Integer key: rows in time order, for free.
        `CREATE TABLE coin_ledger (
            id INTEGER PRIMARY KEY,
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            delta INTEGER NOT NULL,
            reason TEXT NOT NULL,
            reference TEXT,
            created_at INTEGER NOT NULL
        ) STRICT;`,
        // A player's movements (admin, the bank quest). The only index: a coin change costs 2 rows here.
        `CREATE INDEX coin_ledger_player ON coin_ledger (player_id, created_at);`,
        `CREATE TABLE admin_actions (
            id INTEGER PRIMARY KEY,
            admin_id TEXT REFERENCES players(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            target TEXT,
            details TEXT,
            created_at INTEGER NOT NULL
        ) STRICT;`,

        `CREATE TABLE market_listings (
            id TEXT PRIMARY KEY,
            seller_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            type TEXT NOT NULL CHECK (type IN ('auction', 'bin')),
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled', 'expired', 'removed')),
            item_id TEXT NOT NULL,
            source_inventory_id TEXT,
            charges_left INTEGER,
            reforge TEXT,
            pet TEXT,
            obtained_at INTEGER NOT NULL,
            quantity_listed INTEGER NOT NULL CHECK (quantity_listed > 0),
            quantity_left INTEGER NOT NULL CHECK (quantity_left >= 0 AND quantity_left <= quantity_listed),
            unit_price INTEGER CHECK (unit_price > 0),
            starting_bid INTEGER CHECK (starting_bid > 0),
            current_bid INTEGER,
            leading_bidder_id TEXT REFERENCES players(id) ON DELETE SET NULL,
            bid_count INTEGER NOT NULL DEFAULT 0,
            ends_at INTEGER,
            fee_paid INTEGER NOT NULL DEFAULT 0,
            proceeds INTEGER NOT NULL DEFAULT 0 CHECK (proceeds >= 0),
            proceeds_collected INTEGER NOT NULL DEFAULT 0 CHECK (proceeds_collected <= proceeds),
            created_at INTEGER NOT NULL,
            ended_at INTEGER,
            CHECK ((type = 'bin') = (unit_price IS NOT NULL)),
            CHECK ((type = 'auction') = (starting_bid IS NOT NULL AND ends_at IS NOT NULL))
        ) STRICT, WITHOUT ROWID;`,
        `CREATE INDEX market_listings_active ON market_listings (type, item_id, unit_price, created_at) WHERE status = 'active';`,
        `CREATE INDEX market_listings_seller ON market_listings (seller_id, created_at);`,
        `CREATE INDEX market_listings_ending ON market_listings (ends_at) WHERE status = 'active' AND type = 'auction';`,
        `CREATE TABLE market_bids (
            id INTEGER PRIMARY KEY,
            listing_id TEXT NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
            bidder_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            amount INTEGER NOT NULL CHECK (amount > 0),
            status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'returned', 'won')),
            created_at INTEGER NOT NULL
        ) STRICT;`,
        `CREATE INDEX market_bids_listing ON market_bids (listing_id, created_at);`,
        `CREATE INDEX market_bids_bidder ON market_bids (bidder_id, status);`,
        `CREATE UNIQUE INDEX market_bids_one_held ON market_bids (listing_id) WHERE status = 'held';`,
        `CREATE TABLE market_sales (
            id INTEGER PRIMARY KEY,
            listing_id TEXT NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
            buyer_id TEXT REFERENCES players(id) ON DELETE SET NULL,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            paid INTEGER NOT NULL CHECK (paid >= 0),
            created_at INTEGER NOT NULL
        ) STRICT;`,
        `CREATE INDEX market_sales_listing ON market_sales (listing_id);`,

        // candidate_ids: a JSON array of mayor ids.
        `CREATE TABLE elections (
            id TEXT PRIMARY KEY,
            candidate_ids TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
            starts_at INTEGER NOT NULL,
            ends_at INTEGER NOT NULL,
            winner_id TEXT,
            closed_at INTEGER
        ) STRICT, WITHOUT ROWID;`,
        `CREATE UNIQUE INDEX elections_one_open ON elections (status) WHERE status = 'open';`,
        // The mayor in office: the latest closed election.
        `CREATE INDEX elections_closed ON elections (closed_at) WHERE status = 'closed';`,
        `CREATE TABLE election_votes (
            election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            candidate_id TEXT NOT NULL,
            weight INTEGER NOT NULL CHECK (weight > 0),
            created_at INTEGER NOT NULL,
            PRIMARY KEY (election_id, player_id)
        ) STRICT, WITHOUT ROWID;`,

        // chests: JSON, every chest's contents rolled at the win.
        `CREATE TABLE chest_selections (
            id TEXT PRIMARY KEY,
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            source_kind TEXT NOT NULL,
            source_name TEXT NOT NULL,
            run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE SET NULL,
            chests TEXT NOT NULL,
            opened_index INTEGER,
            opened_at INTEGER,
            created_at INTEGER NOT NULL,
            CHECK ((opened_index IS NULL) = (opened_at IS NULL))
        ) STRICT;`,
        // Pending ones (oldest first) and opened ones (newest first), both per player.
        `CREATE INDEX chest_selections_player ON chest_selections (player_id, opened_at, created_at);`,

        `CREATE TABLE location_suggestions (
            id TEXT PRIMARY KEY,
            player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
            kind TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            original_latitude REAL,
            original_longitude REAL,
            note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 280),
            player_latitude REAL NOT NULL,
            player_longitude REAL NOT NULL,
            gps_accuracy REAL,
            distance_metres REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
            review_note TEXT CHECK (length(review_note) <= 280),
            reviewed_by TEXT REFERENCES players(id) ON DELETE SET NULL,
            reviewed_at INTEGER,
            created_at INTEGER NOT NULL
        ) STRICT, WITHOUT ROWID;`,
        `CREATE INDEX location_suggestions_status ON location_suggestions (status, created_at);`,

        // settings: JSON, per kind. active: 1 or 0.
        `CREATE TABLE places (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('mining', 'fishing', 'farming', 'foraging', 'landmark')),
            name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 60),
            description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 280),
            latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
            longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
            settings TEXT NOT NULL DEFAULT '{}',
            active INTEGER NOT NULL DEFAULT 1,
            created_by TEXT REFERENCES players(id) ON DELETE SET NULL,
            suggestion_id TEXT UNIQUE REFERENCES location_suggestions(id) ON DELETE SET NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        ) STRICT, WITHOUT ROWID;`,
        // The map's box query; inactive places aren't in it.
        `CREATE INDEX places_active_position ON places (latitude, longitude) WHERE active;`,
        // Admin's list, newest first.
        `CREATE INDEX places_created ON places (created_at);`,

        // One row per pair, whichever way it was asked.
        `CREATE TABLE friendships (
            id TEXT PRIMARY KEY,
            requester_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            addressee_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
            created_at INTEGER NOT NULL,
            accepted_at INTEGER,
            CHECK (requester_id <> addressee_id)
        ) STRICT, WITHOUT ROWID;`,
        `CREATE UNIQUE INDEX friendships_pair ON friendships (min(requester_id, addressee_id), max(requester_id, addressee_id));`,
        `CREATE INDEX friendships_requester ON friendships (requester_id, status);`,
        `CREATE INDEX friendships_addressee ON friendships (addressee_id, status);`,

        `CREATE TABLE feedback (
            id TEXT PRIMARY KEY,
            player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
            kind TEXT NOT NULL CHECK (kind IN ('bug', 'suggestion', 'other')),
            title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
            body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
            app_version TEXT,
            platform TEXT,
            status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'planned', 'done', 'wontfix')),
            updated_by TEXT REFERENCES players(id) ON DELETE SET NULL,
            updated_at INTEGER,
            created_at INTEGER NOT NULL
        ) STRICT, WITHOUT ROWID;`,
        `CREATE INDEX feedback_status ON feedback (status, created_at);`,
        `CREATE INDEX feedback_player ON feedback (player_id, created_at);`,

        `CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('feedbackReply', 'contest')),
            title TEXT NOT NULL CHECK (length(title) <= 80),
            body TEXT NOT NULL CHECK (length(body) <= 4000),
            sent_by TEXT REFERENCES players(id) ON DELETE SET NULL,
            feedback_id TEXT REFERENCES feedback(id) ON DELETE SET NULL,
            read_at INTEGER,
            created_at INTEGER NOT NULL
        ) STRICT, WITHOUT ROWID;`,
        `CREATE INDEX messages_player ON messages (player_id, created_at);`,
        `CREATE INDEX messages_feedback ON messages (feedback_id) WHERE feedback_id IS NOT NULL;`,
        `CREATE TABLE announcements (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('news', 'changelog', 'event', 'mayor')),
            title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
            body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
            version TEXT,
            posted_by TEXT REFERENCES players(id) ON DELETE SET NULL,
            expires_at INTEGER,
            created_at INTEGER NOT NULL,
            CHECK (kind <> 'changelog' OR version IS NOT NULL)
        ) STRICT, WITHOUT ROWID;`,
        `CREATE INDEX announcements_created ON announcements (created_at);`,

        // Weekly farm contests. A harvest moves the score, so a row and its rank entry.
        `CREATE TABLE farm_contest_scores (
            week INTEGER NOT NULL,
            contest TEXT NOT NULL CHECK (contest IN ('harvest', 'mutation', 'crop')),
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (week, contest, player_id)
        ) STRICT, WITHOUT ROWID;`,
        `CREATE INDEX farm_contest_scores_rank ON farm_contest_scores (week, contest, score DESC);`,
        `CREATE TABLE farm_weeks (
            week INTEGER PRIMARY KEY,
            announced_at INTEGER,
            settled_at INTEGER
        ) STRICT;`,
        // A farm's whole grid is one JSON row.
        `CREATE TABLE farms (
            player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
            state TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        ) STRICT;`,

        // progress: JSON, objective id → count. tracked: 1 or 0.
        `CREATE TABLE player_quests (
            player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            quest_id TEXT NOT NULL,
            progress TEXT NOT NULL DEFAULT '{}',
            tracked INTEGER NOT NULL DEFAULT 0,
            started_at INTEGER NOT NULL,
            claimed_at INTEGER,
            PRIMARY KEY (player_id, quest_id)
        ) STRICT, WITHOUT ROWID;`,
    ],

    // 3: the scheduler (modules/jobs). One row per thing that must happen at a
    // time with nobody acting: a shared fight's turn clock, a dungeon's
    // ready-up, the daily cleanup, the farm week. The World keeps one alarm
    // at the soonest. No index on `at`: the table holds one row per live
    // fight or dungeon plus a few, and every reschedule would write one.
    [
        `CREATE TABLE due (
            key TEXT PRIMARY KEY,
            at INTEGER NOT NULL
        ) STRICT, WITHOUT ROWID;`,
        // A dungeon's next wake is a `due` row now.
        `DROP INDEX dungeon_runs_wake;`,
        `ALTER TABLE dungeon_runs DROP COLUMN wake_at;`,
    ],

    // 4: nothing reads a player's past Runs but the socket's snapshot of
    // their latest shared fight (session 5), so only shared-fight rows pay
    // for an entry: one write fewer per fight or fishing spot. A player's
    // deletion (rare, an admin's) scans for their Runs.
    [
        `DROP INDEX runs_player;`,
        `CREATE INDEX runs_player_shared ON runs (player_id, created_at) WHERE battle_id IS NOT NULL;`,
    ],

    // 5: the Market. Browsing walks the live single items (stacks have no
    // source copy) newest first and stops at the page's 500; an entry costs a
    // write when a single is listed and when it ends.
    //
    // The refund (from server/src/db/geo.schema.ts): a deleted
    // player takes their listings with them; other players' coins held by
    // bids on those listings go back to them first, through the ledger,
    // rather than vanishing. Only an admin deletes a player.
    [
        `CREATE INDEX market_listings_singles ON market_listings (created_at)
            WHERE status = 'active' AND source_inventory_id IS NOT NULL;`,
        `CREATE TRIGGER market_refund_on_seller_delete BEFORE DELETE ON players
        BEGIN
            INSERT INTO coin_ledger (player_id, delta, reason, reference, created_at)
            SELECT b.bidder_id, b.amount, 'market-bid-return', 'listing:' || b.listing_id, CAST(unixepoch('subsec') * 1000 AS INTEGER)
            FROM market_listings l JOIN market_bids b ON b.listing_id = l.id AND b.status = 'held'
            WHERE l.seller_id = OLD.id AND b.bidder_id <> OLD.id;

            UPDATE players SET coins = coins + (
                SELECT sum(b.amount)
                FROM market_listings l JOIN market_bids b ON b.listing_id = l.id AND b.status = 'held'
                WHERE l.seller_id = OLD.id AND b.bidder_id = players.id
            )
            WHERE id IN (
                SELECT b.bidder_id
                FROM market_listings l JOIN market_bids b ON b.listing_id = l.id AND b.status = 'held'
                WHERE l.seller_id = OLD.id AND b.bidder_id <> OLD.id
            );

            UPDATE market_bids SET status = 'returned'
            WHERE status = 'held' AND listing_id IN (SELECT id FROM market_listings WHERE seller_id = OLD.id);
        END;`,
    ],

    // 6: when a player in a party or a shared fight went offline. Their
    // reconnect window and turn clock count from it, and the World forgets
    // it in memory whenever it hibernates (any quiet moment with sockets
    // open). One row per drop that matters, gone when they're back.
    [`CREATE TABLE gone (player_id TEXT PRIMARY KEY, since INTEGER NOT NULL) STRICT, WITHOUT ROWID;`],
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
