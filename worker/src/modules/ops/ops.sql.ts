/**
 * Player progress the wipe deletes, children before parents so no row is
 * left pointing at a deleted one. Accounts, friends, mail, feedback and the
 * world's own content (places, suggestions, elections, announcements, farm
 * weeks) stay.
 */
export const PROGRESS_TABLES = [
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
] as const;

/** Every player back to a new account's numbers. */
export const RESET_PLAYERS = `
  UPDATE players SET coins = 0, bank_coins = 0, wardrobe_bought = 0, active_loadout = NULL, talisman_bag_pages = 1,
    lunchbox_slots = 1, bait_slots = 1, health = NULL, camp_latitude = NULL, camp_longitude = NULL, camp_set_at = NULL;
`;

/** Timed work for the fights, dungeons and auctions the wipe deletes. */
export const DELETE_PROGRESS_JOBS = `
  DELETE FROM due WHERE key LIKE 'battle:%' OR key LIKE 'dungeon:%' OR key LIKE 'auction:%';
`;
