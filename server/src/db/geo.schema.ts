import { query } from "./";

/**
 * geo-game's tables, all in their own `geo` Postgres schema. For now that
 * schema still sits in cozy-app's database (`DB_NAME`), so nothing is named
 * alongside cozy-app's tables. Run once at boot.
 *
 * Idempotent and additive only. Introduce real migrations before the first destructive change.
 */
export async function ensureGeoSchema(): Promise<void> {
    await query(`CREATE SCHEMA IF NOT EXISTS geo;`);
    for (const statement of STATEMENTS) await query(statement);
}

const STATEMENTS = [
    // An anonymous player, created from the phone. Coins live here; every
    // change to them also writes a coin_ledger row.
    `CREATE TABLE IF NOT EXISTS geo.players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        display_name VARCHAR(40) NOT NULL DEFAULT 'Adventurer',
        coins BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    // Bag pages are bought from a vendor; everyone starts with one.
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS talisman_bag_pages INTEGER NOT NULL DEFAULT 1
        CHECK (talisman_bag_pages >= 1);`,

    // A player is its own account: email and password are geo-game's, apart
    // from cozy-app's users. Players from before that (anonymous device
    // ones, then ones tied to a cozy-app user) are deleted: dev data only, nothing
    // was in production.
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS email VARCHAR(255);`,
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS password_hash TEXT;`,
    `DELETE FROM geo.players WHERE email IS NULL OR password_hash IS NULL;`,
    `ALTER TABLE geo.players ALTER COLUMN email SET NOT NULL;`,
    `ALTER TABLE geo.players ALTER COLUMN password_hash SET NOT NULL;`,
    `ALTER TABLE geo.players DROP COLUMN IF EXISTS user_id;`,
    // Case-insensitive: "Me@x.com" and "me@x.com" are one account, and two
    // players can't both be "Ash" and "ash".
    `CREATE UNIQUE INDEX IF NOT EXISTS players_email_key ON geo.players (lower(email));`,
    `CREATE UNIQUE INDEX IF NOT EXISTS players_display_name_key ON geo.players (lower(display_name));`,
    // Game admin.
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'player'
        CHECK (role IN ('player', 'admin'));`,
    // Set by an admin: every request is refused while it is.
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;`,
    // An admin's testing switch: every bite they strike is a sea creature.
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS always_sea_creatures BOOLEAN NOT NULL DEFAULT false;`,

    // Hashes only: a leaked table can't be used to sign in.
    `CREATE TABLE IF NOT EXISTS geo.refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
    );`,

    // One row per owned copy, or per stack for materials. `item_id` is a
    // content id (server/src/content), not a foreign key: content lives
    // in code.
    `CREATE TABLE IF NOT EXISTS geo.inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        item_id VARCHAR(80) NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
        charges_left INTEGER CHECK (charges_left >= 0),
        obtained_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE INDEX IF NOT EXISTS inventory_player_idx ON geo.inventory (player_id);`,
    // A weapon or armor copy's reforge (data/reforges/), rolled at a vendor.
    `ALTER TABLE geo.inventory ADD COLUMN IF NOT EXISTS reforge VARCHAR(80);`,
    // A pet copy's XP and held item, { xp, heldItem } (pets/pets.ts PetCopy); NULL for anything else.
    `ALTER TABLE geo.inventory ADD COLUMN IF NOT EXISTS pet JSONB;`,
    // A first try kept the active pet on geo.players; it's geo.active_pets now.
    `ALTER TABLE geo.players DROP COLUMN IF EXISTS active_pet;`,
    // The one pet giving its stats, kept like geo.equipment: gone with the copy.
    `CREATE TABLE IF NOT EXISTS geo.active_pets (
        player_id UUID PRIMARY KEY REFERENCES geo.players(id) ON DELETE CASCADE,
        inventory_id UUID NOT NULL UNIQUE REFERENCES geo.inventory(id) ON DELETE CASCADE
    );`,
    // A pet left with Kat to raise its rarity: out of the inventory, kept as
    // it was (id, XP, held item), until it's collected as to_item_id. One at a time.
    `CREATE TABLE IF NOT EXISTS geo.pet_upgrades (
        player_id UUID PRIMARY KEY REFERENCES geo.players(id) ON DELETE CASCADE,
        inventory_id UUID NOT NULL,
        item_id VARCHAR(80) NOT NULL,
        to_item_id VARCHAR(80) NOT NULL,
        pet JSONB NOT NULL,
        obtained_at TIMESTAMPTZ NOT NULL,
        ready_at TIMESTAMPTZ NOT NULL
    );`,

    `CREATE TABLE IF NOT EXISTS geo.equipment (
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        slot VARCHAR(20) NOT NULL,
        inventory_id UUID NOT NULL UNIQUE REFERENCES geo.inventory(id) ON DELETE CASCADE,
        PRIMARY KEY (player_id, slot)
    );`,
    // Rings went from four slots to two; the rings worn in the old 3rd and 4th go back to the bag.
    `DELETE FROM geo.equipment WHERE slot IN ('ring3', 'ring4');`,
    // Rods moved from their own slot to the main hand (2026-10-18): a rod
    // that was worn goes back to the bag.
    `DELETE FROM geo.equipment WHERE slot = 'rod';`,

    // The wardrobe: saved loadouts of gear and a pet. A loadout points at
    // inventory ids rather than holding the items, so no foreign keys: an
    // item that has left is skipped when the loadout is worn, and dropped
    // when it's read. wardrobe_bought counts slots bought past the config's
    // startingSlots. active_loadout is the one being worn, which gear
    // changes keep up to date; null when none is.
    `CREATE TABLE IF NOT EXISTS geo.loadouts (
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        slot SMALLINT NOT NULL CHECK (slot >= 0),
        name VARCHAR(20) NOT NULL,
        equipment JSONB NOT NULL DEFAULT '{}'::jsonb,
        pet_id UUID,
        auto_for VARCHAR(16) CHECK (auto_for IN ('combat', 'fishing')),
        PRIMARY KEY (player_id, slot)
    );`,
    // One loadout per activity, so auto-swap always knows which to wear.
    `CREATE UNIQUE INDEX IF NOT EXISTS loadouts_auto_for_idx ON geo.loadouts (player_id, auto_for) WHERE auto_for IS NOT NULL;`,
    `ALTER TABLE geo.players
        ADD COLUMN IF NOT EXISTS wardrobe_bought SMALLINT NOT NULL DEFAULT 0 CHECK (wardrobe_bought >= 0),
        ADD COLUMN IF NOT EXISTS active_loadout SMALLINT;`,
    // Auto-swap was a bought upgrade; it's free now.
    `ALTER TABLE geo.players DROP COLUMN IF EXISTS wardrobe_auto_swap;`,

    // Talismans count only while in the bag, and only one copy of each: the
    // primary key on item_id is what stops duplicates.
    `CREATE TABLE IF NOT EXISTS geo.talisman_bag (
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        item_id VARCHAR(80) NOT NULL,
        inventory_id UUID NOT NULL UNIQUE REFERENCES geo.inventory(id) ON DELETE CASCADE,
        PRIMARY KEY (player_id, item_id)
    );`,

    // The current hand per skill, as inventory ids in hand order.
    `CREATE TABLE IF NOT EXISTS geo.hands (
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        skill VARCHAR(30) NOT NULL,
        inventory_ids UUID[] NOT NULL DEFAULT '{}',
        PRIMARY KEY (player_id, skill)
    );`,

    // Lunchbox slots unlocked: 1 to start, up to 4 (GEO_LUNCHBOX_MAX_SLOTS).
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS lunchbox_slots INTEGER NOT NULL DEFAULT 1
        CHECK (lunchbox_slots BETWEEN 1 AND 4);`,

    // Food packed for Runs, one stack of one food per slot. Packing moves the
    // food out of geo.inventory (unpacking puts it back), so packed food can't
    // be sold, listed or crafted. The unique index keeps one slot per food.
    `CREATE TABLE IF NOT EXISTS geo.lunchbox (
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        slot SMALLINT NOT NULL CHECK (slot >= 0 AND slot < 4),
        item_id VARCHAR(80) NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        PRIMARY KEY (player_id, slot)
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS lunchbox_one_slot_per_food_idx ON geo.lunchbox (player_id, item_id);`,

    // Bait slots unlocked: 1 to start, up to 4 (GEO_BAIT_MAX_SLOTS).
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS bait_slots INTEGER NOT NULL DEFAULT 1
        CHECK (bait_slots BETWEEN 1 AND 4);`,

    // Bait packed for fishing Runs, kept like geo.lunchbox: one stack of one
    // bait per slot, moved out of geo.inventory while packed.
    `CREATE TABLE IF NOT EXISTS geo.bait (
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        slot SMALLINT NOT NULL CHECK (slot >= 0 AND slot < 4),
        item_id VARCHAR(80) NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        PRIMARY KEY (player_id, slot)
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS bait_one_slot_per_bait_idx ON geo.bait (player_id, item_id);`,

    `CREATE TABLE IF NOT EXISTS geo.skill_xp (
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        skill VARCHAR(30) NOT NULL,
        xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
        PRIMARY KEY (player_id, skill)
    );`,

    // A Run's whole battle lives in `state` between turns.
    `CREATE TABLE IF NOT EXISTS geo.runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        kind VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        enemy_ids TEXT[] NOT NULL DEFAULT '{}',
        state JSONB NOT NULL,
        rewards JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ
    );`,
    `ALTER TABLE geo.runs ADD COLUMN IF NOT EXISTS spawn_id VARCHAR(80);`,
    // What a defeat cost: every coin carried.
    `ALTER TABLE geo.runs ADD COLUMN IF NOT EXISTS coins_lost BIGINT;`,
    // At most one Run in progress per player.
    `CREATE UNIQUE INDEX IF NOT EXISTS runs_one_active_idx
        ON geo.runs (player_id) WHERE status = 'active';`,
    // A Run fought at full health that leaves the player's own as it was
    // (a dungeon's). Others save the player's health every turn.
    `ALTER TABLE geo.runs ADD COLUMN IF NOT EXISTS keeps_health BOOLEAN NOT NULL DEFAULT false;`,

    // Health carried between fights; NULL is full. Clamped to max health
    // (which moves with gear) whenever it's read.
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS health INTEGER CHECK (health >= 1);`,
    // Camp, where the lunchbox and bait are restocked. Stored rounded to
    // about 110 m (GEO_CAMP_DECIMALS), never the exact point the phone sent:
    // it's likely where the player lives. Forgetting it clears the point but
    // keeps camp_set_at, so the move limit can't be dodged that way.
    `ALTER TABLE geo.players
        ADD COLUMN IF NOT EXISTS camp_latitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS camp_longitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS camp_set_at TIMESTAMPTZ;`,
    // Coins in the bank at camp: out of the purse, so a death doesn't take
    // them. Moving coins in or out writes coin_ledger rows like any other
    // change to `coins`; the bank's balance is the negated sum of those.
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS bank_coins BIGINT NOT NULL DEFAULT 0 CHECK (bank_coins >= 0);`,

    // Camp was first called home.
    `ALTER TABLE geo.players
        DROP COLUMN IF EXISTS home_latitude,
        DROP COLUMN IF EXISTS home_longitude,
        DROP COLUMN IF EXISTS home_set_at;`,

    // Each player's spawns, made around them by GET /geo/world and kept only
    // while they last (geo/world/spawns.ts). A beaten one keeps its slot,
    // marked claimed, until it would have despawned.
    `CREATE TABLE IF NOT EXISTS geo.spawns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        enemy_id VARCHAR(80) NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        despawns_at TIMESTAMPTZ NOT NULL,
        claimed_at TIMESTAMPTZ
    );`,
    `CREATE INDEX IF NOT EXISTS spawns_player_idx ON geo.spawns (player_id);`,
    // When the player walked out of its reach; it despawns a little after.
    `ALTER TABLE geo.spawns ADD COLUMN IF NOT EXISTS out_of_reach_since TIMESTAMPTZ;`,
    // When it appeared; new spawns wait a gap after the newest one.
    `ALTER TABLE geo.spawns ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`,
    // Where the player was last seen moving from, overwritten as they walk,
    // and the distance banked toward walking spawns (geo/world/travel.ts).
    // Only this one point is kept: no history.
    `CREATE TABLE IF NOT EXISTS geo.player_travel (
        player_id UUID PRIMARY KEY REFERENCES geo.players(id) ON DELETE CASCADE,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        seen_at TIMESTAMPTZ NOT NULL,
        banked_metres DOUBLE PRECISION NOT NULL DEFAULT 0
    );`,
    // When the player last got a spawn; the trickle's gap runs from here, so
    // an emptied map (walked or driven away from) isn't refilled at once.
    `ALTER TABLE geo.player_travel ADD COLUMN IF NOT EXISTS last_spawned_at TIMESTAMPTZ;`,
    // Replaced by geo.spawns: spawns were once generated per map cell.
    `DROP TABLE IF EXISTS geo.spawn_claims;`,

    // Named hands to swap back to, per skill.
    `CREATE TABLE IF NOT EXISTS geo.saved_hands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        skill VARCHAR(30) NOT NULL,
        name VARCHAR(40) NOT NULL,
        inventory_ids UUID[] NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE INDEX IF NOT EXISTS saved_hands_player_idx ON geo.saved_hands (player_id, skill);`,

    // Every coin movement, so a balance can always be explained.
    `CREATE TABLE IF NOT EXISTS geo.coin_ledger (
        id BIGSERIAL PRIMARY KEY,
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        delta BIGINT NOT NULL,
        reason VARCHAR(40) NOT NULL,
        reference VARCHAR(80),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,

    // Every change an admin makes, so a grant or a ban can always be explained.
    `CREATE TABLE IF NOT EXISTS geo.admin_actions (
        id BIGSERIAL PRIMARY KEY,
        admin_id UUID REFERENCES geo.players(id) ON DELETE SET NULL,
        action VARCHAR(40) NOT NULL,
        target VARCHAR(80),
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE INDEX IF NOT EXISTS coin_ledger_created_idx ON geo.coin_ledger (created_at);`,
    `CREATE INDEX IF NOT EXISTS coin_ledger_player_idx ON geo.coin_ledger (player_id, created_at);`,

    // The Market. A listing holds its item in escrow: the item leaves the
    // seller's inventory before the listing row exists (same transaction),
    // and comes back (same id, same obtained date) if it's cancelled or
    // expires unsold. Coins a listing earns wait in `proceeds` until the
    // seller collects them.
    `CREATE TABLE IF NOT EXISTS geo.market_listings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        seller_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        type VARCHAR(10) NOT NULL CHECK (type IN ('auction', 'bin')),
        status VARCHAR(12) NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'sold', 'cancelled', 'expired', 'removed')),
        item_id VARCHAR(80) NOT NULL,
        source_inventory_id UUID,
        charges_left INTEGER,
        obtained_at TIMESTAMPTZ NOT NULL,
        quantity_listed INTEGER NOT NULL CHECK (quantity_listed > 0),
        quantity_left INTEGER NOT NULL CHECK (quantity_left >= 0 AND quantity_left <= quantity_listed),
        unit_price BIGINT CHECK (unit_price > 0),
        starting_bid BIGINT CHECK (starting_bid > 0),
        current_bid BIGINT,
        leading_bidder_id UUID REFERENCES geo.players(id) ON DELETE SET NULL,
        bid_count INTEGER NOT NULL DEFAULT 0,
        ends_at TIMESTAMPTZ,
        fee_paid BIGINT NOT NULL DEFAULT 0,
        proceeds BIGINT NOT NULL DEFAULT 0 CHECK (proceeds >= 0),
        proceeds_collected BIGINT NOT NULL DEFAULT 0 CHECK (proceeds_collected <= proceeds),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ,
        CHECK ((type = 'bin') = (unit_price IS NOT NULL)),
        CHECK ((type = 'auction') = (starting_bid IS NOT NULL AND ends_at IS NOT NULL))
    );`,
    `CREATE INDEX IF NOT EXISTS market_listings_active_idx
        ON geo.market_listings (type, item_id, unit_price, created_at) WHERE status = 'active';`,
    `CREATE INDEX IF NOT EXISTS market_listings_seller_idx ON geo.market_listings (seller_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS market_listings_ending_idx
        ON geo.market_listings (ends_at) WHERE status = 'active' AND type = 'auction';`,
    // The listed copy's reforge, handed on with it.
    `ALTER TABLE geo.market_listings ADD COLUMN IF NOT EXISTS reforge VARCHAR(80);`,
    `ALTER TABLE geo.market_listings ADD COLUMN IF NOT EXISTS pet JSONB;`,

    // A bid's coins leave the bidder when it's placed ('held'), and go back
    // when outbid ('returned') or to the seller when it wins ('won').
    `CREATE TABLE IF NOT EXISTS geo.market_bids (
        id BIGSERIAL PRIMARY KEY,
        listing_id UUID NOT NULL REFERENCES geo.market_listings(id) ON DELETE CASCADE,
        bidder_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        amount BIGINT NOT NULL CHECK (amount > 0),
        status VARCHAR(10) NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'returned', 'won')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE INDEX IF NOT EXISTS market_bids_listing_idx ON geo.market_bids (listing_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS market_bids_held_idx ON geo.market_bids (bidder_id) WHERE status = 'held';`,
    // At most one held bid per auction: the leading one.
    `CREATE UNIQUE INDEX IF NOT EXISTS market_bids_one_held_idx ON geo.market_bids (listing_id) WHERE status = 'held';`,

    // Who bought what from a listing. One row for a single item; a stack can
    // sell in many parts.
    `CREATE TABLE IF NOT EXISTS geo.market_sales (
        id BIGSERIAL PRIMARY KEY,
        listing_id UUID NOT NULL REFERENCES geo.market_listings(id) ON DELETE CASCADE,
        buyer_id UUID REFERENCES geo.players(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        paid BIGINT NOT NULL CHECK (paid >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE INDEX IF NOT EXISTS market_sales_listing_idx ON geo.market_sales (listing_id);`,

    // Mayor elections. One is open at a time; when it ends, its winner is the
    // mayor in office (the latest closed election's winner) and the next opens.
    `CREATE TABLE IF NOT EXISTS geo.elections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        candidate_ids TEXT[] NOT NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ends_at TIMESTAMPTZ NOT NULL,
        winner_id VARCHAR(80),
        closed_at TIMESTAMPTZ
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS elections_one_open_idx ON geo.elections ((status)) WHERE status = 'open';`,
    `CREATE INDEX IF NOT EXISTS elections_closed_idx ON geo.elections (closed_at) WHERE status = 'closed';`,

    // One vote per player per election, and no changing it: the primary key
    // refuses a second. `weight` is fixed when cast (1, or more with a
    // vote-weight talisman).
    `CREATE TABLE IF NOT EXISTS geo.election_votes (
        election_id UUID NOT NULL REFERENCES geo.elections(id) ON DELETE CASCADE,
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        candidate_id VARCHAR(80) NOT NULL,
        weight INTEGER NOT NULL CHECK (weight > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (election_id, player_id)
    );`,

    // Chests won together (a boss's), to open one of. Every chest's contents
    // are rolled at the win and kept in `chests`, so nothing rerolls; only
    // the opened one is ever shown. Pending while `opened_at` is null.
    // `cost` is kept per chest, fixed when won.
    `CREATE TABLE IF NOT EXISTS geo.chest_selections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        source_kind VARCHAR(20) NOT NULL,
        source_name VARCHAR(80) NOT NULL,
        run_id UUID UNIQUE REFERENCES geo.runs(id) ON DELETE SET NULL,
        chests JSONB NOT NULL,
        opened_index SMALLINT,
        opened_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK ((opened_index IS NULL) = (opened_at IS NULL))
    );`,
    `CREATE INDEX IF NOT EXISTS chest_selections_pending_idx
        ON geo.chest_selections (player_id, created_at) WHERE opened_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS chest_selections_opened_idx
        ON geo.chest_selections (player_id, opened_at) WHERE opened_at IS NOT NULL;`,

    // Players' suggestions that a real place should be a hub or point of
    // interest, for a game admin to review. A deleted player's suggestions
    // stay, unsigned. Where the player stood is kept beside the pin, so a
    // reviewer can tell whether they were actually there.
    `CREATE TABLE IF NOT EXISTS geo.location_suggestions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID REFERENCES geo.players(id) ON DELETE SET NULL,
        kind VARCHAR(20) NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        note VARCHAR(280) NOT NULL DEFAULT '',
        player_latitude DOUBLE PRECISION NOT NULL,
        player_longitude DOUBLE PRECISION NOT NULL,
        gps_accuracy REAL,
        distance_metres REAL NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
        review_note VARCHAR(280),
        reviewed_by UUID REFERENCES geo.players(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE INDEX IF NOT EXISTS location_suggestions_status_idx
        ON geo.location_suggestions (status, created_at);`,
    // Set the first time an admin moves the pin: where the player put it.
    `ALTER TABLE geo.location_suggestions
        ADD COLUMN IF NOT EXISTS original_latitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS original_longitude DOUBLE PRECISION;`,

    // Hand-made places: hubs and landmarks an admin put on the map, drawn
    // beside the ones the app finds in the tiles. Inactive ones are hidden
    // from players but kept. A suggestion makes at most one place.
    `CREATE TABLE IF NOT EXISTS geo.places (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind VARCHAR(20) NOT NULL
            CHECK (kind IN ('mining', 'fishing', 'farming', 'foraging', 'landmark')),
        name VARCHAR(60) NOT NULL DEFAULT '',
        description VARCHAR(280) NOT NULL DEFAULT '',
        latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by UUID REFERENCES geo.players(id) ON DELETE SET NULL,
        suggestion_id UUID UNIQUE REFERENCES geo.location_suggestions(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    // The Seed Bag is gone: seeds are planted straight from the inventory.
    // Anything still packed is lost (npm run wipe:geo for a clean start).
    `DROP TABLE IF EXISTS geo.seed_bag;`,
    `ALTER TABLE geo.players DROP COLUMN IF EXISTS seed_bag_slots;`,
    `CREATE INDEX IF NOT EXISTS places_active_position_idx
        ON geo.places (latitude, longitude) WHERE active;`,
    // Per-kind settings an admin sets, e.g. a fishing spot's tier.
    `ALTER TABLE geo.places ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';`,
    // The name is optional: empty, and the app calls the place by its type.
    `ALTER TABLE geo.places DROP CONSTRAINT IF EXISTS places_name_check;`,
    `ALTER TABLE geo.places ALTER COLUMN name SET DEFAULT '';`,

    // A deleted player takes their listings with
    // them. Other players' coins held by bids on those listings go back to
    // them first, through the ledger, rather than vanishing.
    `CREATE OR REPLACE FUNCTION geo.refund_bids_on_seller_delete() RETURNS trigger AS $$
    BEGIN
        UPDATE geo.players p SET coins = p.coins + refund.total
        FROM (
            SELECT b.bidder_id, SUM(b.amount) AS total
            FROM geo.market_bids b JOIN geo.market_listings l ON l.id = b.listing_id
            WHERE b.status = 'held' AND l.seller_id = OLD.id AND b.bidder_id <> OLD.id
            GROUP BY b.bidder_id
        ) refund
        WHERE p.id = refund.bidder_id;

        INSERT INTO geo.coin_ledger (player_id, delta, reason, reference)
        SELECT b.bidder_id, b.amount, 'market-bid-return', 'listing:' || b.listing_id
        FROM geo.market_bids b JOIN geo.market_listings l ON l.id = b.listing_id
        WHERE b.status = 'held' AND l.seller_id = OLD.id AND b.bidder_id <> OLD.id;

        UPDATE geo.market_bids b SET status = 'returned'
        FROM geo.market_listings l
        WHERE l.id = b.listing_id AND b.status = 'held' AND l.seller_id = OLD.id;
        RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;`,
    `DROP TRIGGER IF EXISTS refund_bids_on_seller_delete ON geo.players;`,
    `CREATE TRIGGER refund_bids_on_seller_delete BEFORE DELETE ON geo.players
        FOR EACH ROW EXECUTE FUNCTION geo.refund_bids_on_seller_delete();`,

    // Friends (modules/friends): one row per pair, whichever way it was asked.
    // Pending until the addressee accepts; declining or removing deletes it.
    `CREATE TABLE IF NOT EXISTS geo.friendships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        addressee_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        accepted_at TIMESTAMPTZ,
        CHECK (requester_id <> addressee_id)
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_key
        ON geo.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));`,
    `CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON geo.friendships (addressee_id, status);`,
    // Presence, from the app's heartbeat. A null activity means the app said
    // it went away; otherwise online while last_seen_at is recent.
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;`,
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS activity VARCHAR(20);`,
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS activity_skill VARCHAR(40);`,

    // Feedback (modules/feedback): bugs, suggestions and the rest, for a game
    // admin to triage. A deleted player's feedback stays, unsigned. The app
    // version and platform are the app's, so a bug can be placed.
    `CREATE TABLE IF NOT EXISTS geo.feedback (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID REFERENCES geo.players(id) ON DELETE SET NULL,
        kind VARCHAR(20) NOT NULL CHECK (kind IN ('bug', 'suggestion', 'other')),
        title VARCHAR(80) NOT NULL CHECK (length(title) > 0),
        body VARCHAR(2000) NOT NULL DEFAULT '',
        app_version VARCHAR(40),
        platform VARCHAR(40),
        status VARCHAR(20) NOT NULL DEFAULT 'new'
            CHECK (status IN ('new', 'seen', 'planned', 'done', 'wontfix')),
        updated_by UUID REFERENCES geo.players(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE INDEX IF NOT EXISTS feedback_status_idx ON geo.feedback (status, created_at);`,
    `CREATE INDEX IF NOT EXISTS feedback_player_idx ON geo.feedback (player_id, created_at);`,

    // The inbox (modules/inbox). Messages are one player's (an admin's reply
    // to their feedback); read when the player opens the inbox.
    `CREATE TABLE IF NOT EXISTS geo.messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        kind VARCHAR(20) NOT NULL CHECK (kind IN ('feedbackReply')),
        title VARCHAR(80) NOT NULL,
        body VARCHAR(4000) NOT NULL,
        sent_by UUID REFERENCES geo.players(id) ON DELETE SET NULL,
        feedback_id UUID REFERENCES geo.feedback(id) ON DELETE SET NULL,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE INDEX IF NOT EXISTS messages_player_idx ON geo.messages (player_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS messages_feedback_idx ON geo.messages (feedback_id) WHERE feedback_id IS NOT NULL;`,
    // Announcements are everyone's: one row, never copied per player. A
    // player's inbox_read_at says which are read (null: none since joining).
    // posted_by is null for the server's own, e.g. a new mayor.
    `CREATE TABLE IF NOT EXISTS geo.announcements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind VARCHAR(20) NOT NULL CHECK (kind IN ('news', 'changelog', 'event', 'mayor')),
        title VARCHAR(80) NOT NULL CHECK (length(title) > 0),
        body VARCHAR(4000) NOT NULL DEFAULT '',
        version VARCHAR(40),
        posted_by UUID REFERENCES geo.players(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (kind <> 'changelog' OR version IS NOT NULL)
    );`,
    `CREATE INDEX IF NOT EXISTS announcements_created_idx ON geo.announcements (created_at);`,
    // A message can also be a player's farm contest results.
    `ALTER TABLE geo.messages DROP CONSTRAINT IF EXISTS messages_kind_check;`,
    `ALTER TABLE geo.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('feedbackReply', 'contest'));`,

    // Weekly farm contests (modules/farming). A harvest adds to the player's
    // score for its week; weeks run Monday to Monday UTC, counted by
    // farming/farm.ts weekOf. `mutation` keeps the best single harvest.
    `CREATE TABLE IF NOT EXISTS geo.farm_contest_scores (
        week INTEGER NOT NULL,
        contest VARCHAR(20) NOT NULL CHECK (contest IN ('harvest', 'mutation', 'crop')),
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        score BIGINT NOT NULL DEFAULT 0 CHECK (score >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (week, contest, player_id)
    );`,
    `CREATE INDEX IF NOT EXISTS farm_contest_scores_rank_idx ON geo.farm_contest_scores (week, contest, score DESC);`,
    // One row per week once its start is announced and its contests settled;
    // the job uses them so each happens once, even with several servers.
    `CREATE TABLE IF NOT EXISTS geo.farm_weeks (
        week INTEGER PRIMARY KEY,
        announced_at TIMESTAMPTZ,
        settled_at TIMESTAMPTZ
    );`,
    `ALTER TABLE geo.players ADD COLUMN IF NOT EXISTS inbox_read_at TIMESTAMPTZ;`,

    // Farming (modules/farming). One farm per player, made the first time
    // they look at it; its whole grid lives in `state` (farming/farm.ts), so
    // it moves to one row in a Durable Object later without reshaping.
    `CREATE TABLE IF NOT EXISTS geo.farms (
        player_id UUID PRIMARY KEY REFERENCES geo.players(id) ON DELETE CASCADE,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,

    // Dungeon lobbies (modules/dungeons). Open until the host starts it
    // (started_at, everyone goes in) or it closes (closed_at: the host left
    // or was away too long). Only open lobbies are ever shown.
    `CREATE TABLE IF NOT EXISTS geo.dungeon_lobbies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dungeon_id VARCHAR(80) NOT NULL,
        host_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        required_level SMALLINT NOT NULL CONSTRAINT dungeon_lobbies_level_min CHECK (required_level >= 0),
        max_players SMALLINT NOT NULL CHECK (max_players >= 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        closed_at TIMESTAMPTZ
    );`,
    // Lobbies first had a countdown (starts_at) and required level 1+; now
    // the host starts them, and 0 means anyone.
    `ALTER TABLE geo.dungeon_lobbies DROP COLUMN IF EXISTS starts_at;`,
    `ALTER TABLE geo.dungeon_lobbies DROP CONSTRAINT IF EXISTS dungeon_lobbies_required_level_check;`,
    `CREATE INDEX IF NOT EXISTS dungeon_lobbies_open_idx
        ON geo.dungeon_lobbies (created_at) WHERE closed_at IS NULL AND started_at IS NULL;`,
    // Who's in each lobby.
    `CREATE TABLE IF NOT EXISTS geo.dungeon_lobby_members (
        lobby_id UUID NOT NULL REFERENCES geo.dungeon_lobbies(id) ON DELETE CASCADE,
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (lobby_id, player_id)
    );`,
    // Members once entered one by one; starting now takes everyone in at once.
    `ALTER TABLE geo.dungeon_lobby_members DROP COLUMN IF EXISTS entered_at;`,
    `CREATE INDEX IF NOT EXISTS dungeon_lobby_members_player_idx ON geo.dungeon_lobby_members (player_id);`,
    // The dungeon a Run is its boss fight for; NULL for any other Run. A win
    // counts toward quests' dungeon objectives.
    `ALTER TABLE geo.runs ADD COLUMN IF NOT EXISTS dungeon_id VARCHAR(80);`,

    // A started dungeon's map, walked room by room (modules/dungeon-runs):
    // one per party. The first version was one per player; those runs (and
    // their room fights) are dropped rather than converted.
    `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'geo' AND table_name = 'dungeon_runs' AND column_name = 'player_id') THEN
            DELETE FROM geo.runs WHERE dungeon_run_id IS NOT NULL;
            DROP TABLE geo.dungeon_runs CASCADE;
        END IF;
    END $$;`,
    // The rolled map is a snapshot: editing a layout or a deploy never
    // changes a run in progress. state is the party's shared side (explored
    // and cleared rooms, puzzles with their hidden answers), so it never goes
    // to the app as-is. version goes up with every save, the party's or any
    // member's, so the app can drop pushes older than what it holds. Over
    // ('won' or 'failed') once nobody is left in it.
    `CREATE TABLE IF NOT EXISTS geo.dungeon_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dungeon_id VARCHAR(80) NOT NULL,
        lobby_id UUID REFERENCES geo.dungeon_lobbies(id) ON DELETE SET NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'failed')),
        map JSONB NOT NULL,
        state JSONB NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ
    );`,
    // Who went in, each with their own side of the run (room, health, keys
    // used, their loot and events). status: still in, beat the boss, or out
    // (died or left). One active dungeon per player.
    `CREATE TABLE IF NOT EXISTS geo.dungeon_run_members (
        dungeon_run_id UUID NOT NULL REFERENCES geo.dungeon_runs(id) ON DELETE CASCADE,
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'failed')),
        state JSONB NOT NULL,
        -- Lobby join order: the party list's order.
        seat SMALLINT NOT NULL,
        ended_at TIMESTAMPTZ,
        PRIMARY KEY (dungeon_run_id, player_id)
    );`,
    // When the run next needs settling with nobody acting: the ready-up
    // clock running out, a player offline too long (geo-dungeon-runs.clock.ts).
    `ALTER TABLE geo.dungeon_runs ADD COLUMN IF NOT EXISTS wake_at TIMESTAMPTZ;`,
    `CREATE INDEX IF NOT EXISTS dungeon_runs_wake_idx ON geo.dungeon_runs (wake_at) WHERE status = 'active';`,
    `CREATE UNIQUE INDEX IF NOT EXISTS dungeon_run_members_one_active_idx
        ON geo.dungeon_run_members (player_id) WHERE status = 'active';`,
    // A room fight's dungeon run and room; NULL for any other Run. The
    // second statement puts the reference back after the drop above.
    `ALTER TABLE geo.runs ADD COLUMN IF NOT EXISTS dungeon_run_id UUID REFERENCES geo.dungeon_runs(id) ON DELETE CASCADE;`,
    `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_dungeon_run_id_fkey') THEN
            ALTER TABLE geo.runs ADD CONSTRAINT runs_dungeon_run_id_fkey
                FOREIGN KEY (dungeon_run_id) REFERENCES geo.dungeon_runs(id) ON DELETE CASCADE;
        END IF;
    END $$;`,
    `ALTER TABLE geo.runs ADD COLUMN IF NOT EXISTS dungeon_room SMALLINT;`,

    // A shared fight (a dungeon's boss with the party): one Runs row per
    // player, as for any fight (their own status, rewards, dungeon link),
    // grouped by battle_id, each holding the same battle state, all written
    // together under every player's lock. combatant_id is the player's side
    // of it. The turn clock: when the current turn began, and when it's
    // skipped (sooner for a player who dropped). version counts saves, so
    // the app can drop a push older than what it shows.
    `ALTER TABLE geo.runs
        ADD COLUMN IF NOT EXISTS battle_id UUID,
        ADD COLUMN IF NOT EXISTS combatant_id VARCHAR(40),
        ADD COLUMN IF NOT EXISTS turn_started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS turn_deadline TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;`,
    `CREATE INDEX IF NOT EXISTS runs_battle_idx ON geo.runs (battle_id) WHERE battle_id IS NOT NULL;`,

    // Quests a player holds (modules/quests), one row each, kept once turned
    // in (claimed_at) so a Trial's tier stays open and a quest never comes
    // back. progress is objective id → count, capped at its target.
    `CREATE TABLE IF NOT EXISTS geo.player_quests (
        player_id UUID NOT NULL REFERENCES geo.players(id) ON DELETE CASCADE,
        quest_id VARCHAR(80) NOT NULL,
        progress JSONB NOT NULL DEFAULT '{}',
        tracked BOOLEAN NOT NULL DEFAULT false,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        claimed_at TIMESTAMPTZ,
        PRIMARY KEY (player_id, quest_id)
    );`,

    // chum-slick was renamed bloody-bait: carry over what players held, so a
    // packed slot of it doesn't sit there unknown (hidden, uncastable, full).
    `UPDATE geo.inventory SET item_id = 'bloody-bait' WHERE item_id = 'chum-slick';`,
    `UPDATE geo.market_listings SET item_id = 'bloody-bait' WHERE item_id = 'chum-slick';`,
    `UPDATE geo.bait b SET item_id = 'bloody-bait' WHERE item_id = 'chum-slick'
        AND NOT EXISTS (SELECT 1 FROM geo.bait o WHERE o.player_id = b.player_id AND o.item_id = 'bloody-bait');`,
];
