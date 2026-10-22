// The player's own state.
// Differences from Postgres: no FOR UPDATE (the World runs one request at a
// time), `= ANY($1)` is `IN (SELECT value FROM json_each(?))` with a JSON
// array, times are ms passed in, and JSON columns are TEXT.

const INVENTORY_COLUMNS = `id, item_id, quantity, charges_left, reforge, pet, obtained_at`;

export const FIND_PLAYER = `
  SELECT id, display_name, coins, bank_coins, role, created_at FROM players WHERE id = ?;
`;

/** The few per-player counts and settings kept on the player row. */
export const FIND_PLAYER_STATE = `
  SELECT talisman_bag_pages, lunchbox_slots, bait_slots, health, camp_latitude, camp_longitude, camp_set_at
  FROM players WHERE id = ?;
`;

export const FIND_INVENTORY = `
  SELECT ${INVENTORY_COLUMNS} FROM inventory WHERE player_id = ? ORDER BY obtained_at, id;
`;

/** ? 2: a JSON array of ids. */
export const FIND_INVENTORY_BY_IDS = `
  SELECT ${INVENTORY_COLUMNS} FROM inventory
  WHERE player_id = ? AND id IN (SELECT value FROM json_each(?));
`;

export const FIND_INVENTORY_ROW = `
  SELECT ${INVENTORY_COLUMNS} FROM inventory WHERE player_id = ? AND id = ?;
`;

export const FIND_EQUIPMENT = `SELECT slot, inventory_id FROM equipment WHERE player_id = ?;`;

export const FIND_TALISMAN_BAG = `SELECT item_id, inventory_id FROM talisman_bag WHERE player_id = ?;`;

export const INSERT_TALISMAN_BAG = `INSERT INTO talisman_bag (player_id, item_id, inventory_id) VALUES (?, ?, ?);`;

export const DELETE_TALISMAN_BAG = `DELETE FROM talisman_bag WHERE player_id = ? AND inventory_id = ?;`;

export const FIND_HANDS = `SELECT skill, inventory_ids FROM hands WHERE player_id = ?;`;

export const FIND_HAND = `SELECT skill, inventory_ids FROM hands WHERE player_id = ? AND skill = ?;`;

/** ? 3: a JSON array of ids, in hand order. */
export const UPSERT_HAND = `
  INSERT INTO hands (player_id, skill, inventory_ids) VALUES (?, ?, ?)
  ON CONFLICT (player_id, skill) DO UPDATE SET inventory_ids = excluded.inventory_ids;
`;

export const FIND_SAVED_HANDS = `
  SELECT id, skill, name, inventory_ids, created_at FROM saved_hands WHERE player_id = ? ORDER BY created_at;
`;

export const FIND_SAVED_HAND = `
  SELECT id, skill, name, inventory_ids, created_at FROM saved_hands WHERE player_id = ? AND id = ?;
`;

export const COUNT_SAVED_HANDS = `
  SELECT count(*) AS count FROM saved_hands WHERE player_id = ? AND skill = ?;
`;

export const INSERT_SAVED_HAND = `
  INSERT INTO saved_hands (player_id, id, skill, name, inventory_ids, created_at) VALUES (?, ?, ?, ?, ?, ?);
`;

export const DELETE_SAVED_HAND = `DELETE FROM saved_hands WHERE player_id = ? AND id = ?;`;

export const FIND_LUNCHBOX = `SELECT slot, item_id, quantity FROM lunchbox WHERE player_id = ? ORDER BY slot;`;

/** Puts a stack in a slot, replacing what was there. */
export const UPSERT_LUNCHBOX_SLOT = `
  INSERT INTO lunchbox (player_id, slot, item_id, quantity) VALUES (?, ?, ?, ?)
  ON CONFLICT (player_id, slot) DO UPDATE SET item_id = excluded.item_id, quantity = excluded.quantity;
`;

/** After eating: only if the slot still holds that food in the amount the fight thinks (? 5). */
export const EAT_FROM_LUNCHBOX = `
  UPDATE lunchbox SET quantity = ?
  WHERE player_id = ? AND slot = ? AND item_id = ? AND quantity = ?
  RETURNING slot;
`;

/** The last one eaten: same guard as EAT_FROM_LUNCHBOX. */
export const EAT_LAST_FROM_LUNCHBOX = `
  DELETE FROM lunchbox WHERE player_id = ? AND slot = ? AND item_id = ? AND quantity = ?
  RETURNING slot;
`;

export const DELETE_LUNCHBOX_SLOT = `DELETE FROM lunchbox WHERE player_id = ? AND slot = ?;`;

export const FIND_BAIT = `SELECT slot, item_id, quantity FROM bait WHERE player_id = ? ORDER BY slot;`;

export const UPSERT_BAIT_SLOT = `
  INSERT INTO bait (player_id, slot, item_id, quantity) VALUES (?, ?, ?, ?)
  ON CONFLICT (player_id, slot) DO UPDATE SET item_id = excluded.item_id, quantity = excluded.quantity;
`;

/** One bait on the hook, guarded on what the cast thought was there. */
export const USE_BAIT = `
  UPDATE bait SET quantity = quantity - 1
  WHERE player_id = ? AND slot = ? AND item_id = ? AND quantity = ? AND quantity > 1
  RETURNING slot;
`;

export const USE_LAST_BAIT = `
  DELETE FROM bait WHERE player_id = ? AND slot = ? AND item_id = ? AND quantity = ? AND quantity = 1
  RETURNING slot;
`;

export const DELETE_BAIT_SLOT = `DELETE FROM bait WHERE player_id = ? AND slot = ?;`;

export const FIND_SKILL_XP = `SELECT skill, xp FROM skill_xp WHERE player_id = ?;`;

export const ADD_SKILL_XP = `
  INSERT INTO skill_xp (player_id, skill, xp) VALUES (?, ?, ?)
  ON CONFLICT (player_id, skill) DO UPDATE SET xp = xp + excluded.xp;
`;

export const ADD_COINS = `UPDATE players SET coins = coins + ? WHERE id = ? RETURNING coins;`;

/** Takes coins only if there are enough; no row back means there weren't. */
export const SPEND_COINS = `UPDATE players SET coins = coins - ? WHERE id = ? AND coins >= ? RETURNING coins;`;

export const FIND_COINS = `SELECT coins FROM players WHERE id = ?;`;

export const INSERT_COIN_LEDGER = `
  INSERT INTO coin_ledger (player_id, delta, reason, reference, created_at) VALUES (?, ?, ?, ?, ?);
`;

/** Purse → bank, only if the purse holds that much. */
export const BANK_DEPOSIT = `
  UPDATE players SET coins = coins - ?, bank_coins = bank_coins + ? WHERE id = ? AND coins >= ? RETURNING coins;
`;

/** Bank → purse, only if the bank holds that much. */
export const BANK_WITHDRAW = `
  UPDATE players SET coins = coins + ?, bank_coins = bank_coins - ? WHERE id = ? AND bank_coins >= ? RETURNING coins;
`;

export const INSERT_INVENTORY = `
  INSERT INTO inventory (player_id, id, item_id, quantity, charges_left, reforge, pet, obtained_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;

/** Adds to the player's oldest stack of the item, if there is one. */
export const ADD_TO_STACK = `
  UPDATE inventory SET quantity = quantity + ?
  WHERE player_id = ? AND id = (
    SELECT id FROM inventory
    WHERE player_id = ? AND item_id = ? AND charges_left IS NULL
    ORDER BY obtained_at LIMIT 1
  )
  RETURNING id;
`;

/** Puts a copy back exactly as it was: same id, same obtained date. Nothing back means the id is taken. */
export const RESTORE_INVENTORY_ROW = `
  INSERT INTO inventory (player_id, id, item_id, quantity, charges_left, reforge, pet, obtained_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT DO NOTHING
  RETURNING id;
`;

export const SET_REFORGE = `UPDATE inventory SET reforge = ? WHERE player_id = ? AND id = ? RETURNING id;`;

export const SET_CHARGES = `UPDATE inventory SET charges_left = ? WHERE player_id = ? AND id = ? RETURNING id;`;

export const DELETE_INVENTORY_ROW = `DELETE FROM inventory WHERE player_id = ? AND id = ?;`;

export const TAKE_FROM_STACK = `UPDATE inventory SET quantity = quantity - ? WHERE player_id = ? AND id = ?;`;

/** Every row of one item the player has free to spend (not worn, bagged, in a hand or the active pet), oldest first. */
export const FIND_FREE_ROWS_OF_ITEM = `
  SELECT i.id, i.item_id, i.quantity, i.charges_left, i.reforge, i.pet, i.obtained_at
  FROM inventory i
  WHERE i.player_id = ? AND i.item_id = ?
    AND NOT EXISTS (SELECT 1 FROM equipment e WHERE e.player_id = i.player_id AND e.inventory_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM talisman_bag b WHERE b.player_id = i.player_id AND b.inventory_id = i.id)
    AND NOT EXISTS (
      SELECT 1 FROM hands h, json_each(h.inventory_ids) j WHERE h.player_id = i.player_id AND j.value = i.id
    )
    AND NOT EXISTS (SELECT 1 FROM active_pets a WHERE a.player_id = i.player_id AND a.inventory_id = i.id)
  ORDER BY i.obtained_at;
`;

/** Where an inventory row is in use: worn, bagged, in a hand, or the active pet. 1 or 0 each. */
export const FIND_USES = `
  SELECT
    EXISTS (SELECT 1 FROM equipment WHERE player_id = ? AND inventory_id = ?) AS equipped,
    EXISTS (SELECT 1 FROM talisman_bag WHERE player_id = ? AND inventory_id = ?) AS bagged,
    EXISTS (SELECT 1 FROM hands h, json_each(h.inventory_ids) j WHERE h.player_id = ? AND j.value = ?) AS in_hand,
    EXISTS (SELECT 1 FROM active_pets WHERE player_id = ? AND inventory_id = ?) AS active_pet;
`;

export const UNEQUIP_INVENTORY = `DELETE FROM equipment WHERE player_id = ? AND inventory_id = ?;`;

export const UPSERT_EQUIPMENT = `
  INSERT INTO equipment (player_id, slot, inventory_id) VALUES (?, ?, ?)
  ON CONFLICT (player_id, slot) DO UPDATE SET inventory_id = excluded.inventory_id;
`;

export const CLEAR_SLOT = `DELETE FROM equipment WHERE player_id = ? AND slot = ?;`;

export const CLEAR_EQUIPMENT = `DELETE FROM equipment WHERE player_id = ?;`;

/** The active pet's inventory row, if there is one. */
export const FIND_ACTIVE_PET = `
  SELECT i.id, i.item_id, i.quantity, i.charges_left, i.reforge, i.pet, i.obtained_at
  FROM active_pets a JOIN inventory i ON i.player_id = a.player_id AND i.id = a.inventory_id
  WHERE a.player_id = ?;
`;

export const SET_ACTIVE_PET = `
  INSERT INTO active_pets (player_id, inventory_id) VALUES (?, ?)
  ON CONFLICT (player_id) DO UPDATE SET inventory_id = excluded.inventory_id;
`;

export const CLEAR_ACTIVE_PET = `DELETE FROM active_pets WHERE player_id = ?;`;

const PET_OR_NEW = `coalesce(pet, '{"xp":0,"heldItem":null}')`;

/** Adds XP to a pet copy in one statement. */
export const ADD_PET_XP = `
  UPDATE inventory SET pet = json_set(${PET_OR_NEW}, '$.xp', coalesce(json_extract(pet, '$.xp'), 0) + ?)
  WHERE player_id = ? AND id = ?;
`;

/** Sets only the held item (? 1: JSON, an item id or null). Nothing back means the copy isn't the player's. */
export const SET_PET_HELD_ITEM = `
  UPDATE inventory SET pet = json_set(${PET_OR_NEW}, '$.heldItem', json(?))
  WHERE player_id = ? AND id = ?
  RETURNING id;
`;

export const FIND_PET_UPGRADE = `
  SELECT inventory_id, item_id, to_item_id, pet, obtained_at, ready_at FROM pet_upgrades WHERE player_id = ?;
`;

export const INSERT_PET_UPGRADE = `
  INSERT INTO pet_upgrades (player_id, inventory_id, item_id, to_item_id, pet, obtained_at, ready_at)
  VALUES (?, ?, ?, ?, ?, ?, ?);
`;

export const DELETE_PET_UPGRADE = `
  DELETE FROM pet_upgrades WHERE player_id = ?
  RETURNING inventory_id, item_id, to_item_id, pet, obtained_at, ready_at;
`;

/** ? 1 NULL is full health. */
export const SET_HEALTH = `UPDATE players SET health = ? WHERE id = ?;`;

export const SET_CAMP = `UPDATE players SET camp_latitude = ?, camp_longitude = ?, camp_set_at = ? WHERE id = ?;`;

/** Forgets the point but not when it was set: the move limit still holds. */
export const CLEAR_CAMP = `UPDATE players SET camp_latitude = NULL, camp_longitude = NULL WHERE id = ?;`;
