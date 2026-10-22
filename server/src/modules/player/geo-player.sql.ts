export const FIND_PLAYER = `
  SELECT id, display_name, coins, bank_coins, role, created_at FROM geo.players WHERE id = $1;
`;

export const FIND_INVENTORY = `
  SELECT id, player_id, item_id, quantity, charges_left, reforge, pet, obtained_at
  FROM geo.inventory WHERE player_id = $1 ORDER BY obtained_at, id;
`;

export const FIND_INVENTORY_BY_IDS = `
  SELECT id, player_id, item_id, quantity, charges_left, reforge, pet, obtained_at
  FROM geo.inventory WHERE player_id = $1 AND id = ANY($2::uuid[]);
`;

export const FIND_EQUIPMENT = `
  SELECT slot, inventory_id FROM geo.equipment WHERE player_id = $1;
`;

export const FIND_TALISMAN_BAG_PAGES = `
  SELECT talisman_bag_pages FROM geo.players WHERE id = $1;
`;

/** Locks the player row too, so two adds at once can't overfill the bag. */
export const LOCK_TALISMAN_BAG_PAGES = `
  SELECT talisman_bag_pages FROM geo.players WHERE id = $1 FOR UPDATE;
`;

export const FIND_TALISMAN_BAG = `
  SELECT item_id, inventory_id FROM geo.talisman_bag WHERE player_id = $1;
`;

export const INSERT_TALISMAN_BAG = `
  INSERT INTO geo.talisman_bag (player_id, item_id, inventory_id) VALUES ($1, $2, $3);
`;

export const DELETE_TALISMAN_BAG = `
  DELETE FROM geo.talisman_bag WHERE player_id = $1 AND inventory_id = $2;
`;

export const FIND_HANDS = `
  SELECT skill, inventory_ids FROM geo.hands WHERE player_id = $1;
`;

export const FIND_HAND = `
  SELECT skill, inventory_ids FROM geo.hands WHERE player_id = $1 AND skill = $2;
`;

export const FIND_LUNCHBOX_SLOTS = `
  SELECT lunchbox_slots FROM geo.players WHERE id = $1;
`;

export const FIND_LUNCHBOX = `
  SELECT slot, item_id, quantity FROM geo.lunchbox WHERE player_id = $1 ORDER BY slot;
`;

/** Puts a stack in a slot, replacing what was there. */
export const UPSERT_LUNCHBOX_SLOT = `
  INSERT INTO geo.lunchbox (player_id, slot, item_id, quantity) VALUES ($1, $2, $3, $4)
  ON CONFLICT (player_id, slot) DO UPDATE SET item_id = EXCLUDED.item_id, quantity = EXCLUDED.quantity;
`;

/**
 * After eating: only if the slot still holds that food, in the amount the
 * fight thinks ($4). No row back means it doesn't, and the turn is refused.
 */
export const EAT_FROM_LUNCHBOX = `
  UPDATE geo.lunchbox SET quantity = $5
  WHERE player_id = $1 AND slot = $2 AND item_id = $3 AND quantity = $4
  RETURNING slot;
`;

/** The last one eaten: same guard as EAT_FROM_LUNCHBOX. */
export const EAT_LAST_FROM_LUNCHBOX = `
  DELETE FROM geo.lunchbox
  WHERE player_id = $1 AND slot = $2 AND item_id = $3 AND quantity = $4
  RETURNING slot;
`;

export const DELETE_LUNCHBOX_SLOT = `
  DELETE FROM geo.lunchbox WHERE player_id = $1 AND slot = $2;
`;

export const FIND_BAIT_SLOTS = `
  SELECT bait_slots FROM geo.players WHERE id = $1;
`;

export const FIND_BAIT = `
  SELECT slot, item_id, quantity FROM geo.bait WHERE player_id = $1 ORDER BY slot;
`;

/** Puts a stack in a slot, replacing what was there. */
export const UPSERT_BAIT_SLOT = `
  INSERT INTO geo.bait (player_id, slot, item_id, quantity) VALUES ($1, $2, $3, $4)
  ON CONFLICT (player_id, slot) DO UPDATE SET item_id = EXCLUDED.item_id, quantity = EXCLUDED.quantity;
`;

/** One bait on the hook: guarded on what the cast thought was there, like EAT_FROM_LUNCHBOX. */
export const USE_BAIT = `
  UPDATE geo.bait SET quantity = quantity - 1
  WHERE player_id = $1 AND slot = $2 AND item_id = $3 AND quantity = $4 AND quantity > 1
  RETURNING slot;
`;

/** The last of a slot's bait: same guard as USE_BAIT, and the slot empties. */
export const USE_LAST_BAIT = `
  DELETE FROM geo.bait
  WHERE player_id = $1 AND slot = $2 AND item_id = $3 AND quantity = $4 AND quantity = 1
  RETURNING slot;
`;

export const DELETE_BAIT_SLOT = `
  DELETE FROM geo.bait WHERE player_id = $1 AND slot = $2;
`;


export const FIND_SKILL_XP = `
  SELECT skill, xp FROM geo.skill_xp WHERE player_id = $1;
`;

export const ADD_COINS = `
  UPDATE geo.players SET coins = coins + $2 WHERE id = $1 RETURNING coins;
`;

/** Empties the purse, returning what was in it. */
export const EMPTY_COINS = `
  UPDATE geo.players p SET coins = 0
  FROM (SELECT coins FROM geo.players WHERE id = $1 FOR UPDATE) old
  WHERE p.id = $1
  RETURNING old.coins AS lost;
`;

export const INSERT_COIN_LEDGER = `
  INSERT INTO geo.coin_ledger (player_id, delta, reason, reference) VALUES ($1, $2, $3, $4);
`;

export const INSERT_INVENTORY = `
  INSERT INTO geo.inventory (player_id, item_id, quantity, charges_left, reforge, pet)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id, player_id, item_id, quantity, charges_left, reforge, pet, obtained_at;
`;

/** Adds to an existing stack of the same item, if there is one. */
export const ADD_TO_STACK = `
  UPDATE geo.inventory SET quantity = quantity + $3
  WHERE id = (
    SELECT id FROM geo.inventory
    WHERE player_id = $1 AND item_id = $2 AND charges_left IS NULL
    ORDER BY obtained_at LIMIT 1
  )
  RETURNING id;
`;

/** No row back means the copy is no longer the player's. */
export const SET_REFORGE = `
  UPDATE geo.inventory SET reforge = $3 WHERE player_id = $1 AND id = $2 RETURNING id;
`;

/** No row back means the card is no longer the player's. */
export const SET_CHARGES = `
  UPDATE geo.inventory SET charges_left = $3 WHERE player_id = $1 AND id = $2 RETURNING id;
`;

/**
 * Locks the player row. Anything that must not interleave with a fight
 * (starting one, playing a turn, changing a hand) takes this first, so they
 * queue in one order instead of deadlocking.
 */
export const LOCK_PLAYER = `SELECT id FROM geo.players WHERE id = $1 FOR UPDATE;`;

/** Takes `inventory_id` out of any slot it's in, then puts it in `slot`. */
export const UNEQUIP_INVENTORY = `
  DELETE FROM geo.equipment WHERE player_id = $1 AND inventory_id = $2;
`;

export const UPSERT_EQUIPMENT = `
  INSERT INTO geo.equipment (player_id, slot, inventory_id) VALUES ($1, $2, $3)
  ON CONFLICT (player_id, slot) DO UPDATE SET inventory_id = EXCLUDED.inventory_id;
`;

export const CLEAR_SLOT = `
  DELETE FROM geo.equipment WHERE player_id = $1 AND slot = $2;
`;

export const UPSERT_HAND = `
  INSERT INTO geo.hands (player_id, skill, inventory_ids) VALUES ($1, $2, $3::uuid[])
  ON CONFLICT (player_id, skill) DO UPDATE SET inventory_ids = EXCLUDED.inventory_ids;
`;

export const FIND_SAVED_HANDS = `
  SELECT id, skill, name, inventory_ids, created_at
  FROM geo.saved_hands WHERE player_id = $1 ORDER BY created_at;
`;

export const FIND_SAVED_HAND = `
  SELECT id, skill, name, inventory_ids, created_at
  FROM geo.saved_hands WHERE player_id = $1 AND id = $2;
`;

export const INSERT_SAVED_HAND = `
  INSERT INTO geo.saved_hands (player_id, skill, name, inventory_ids)
  VALUES ($1, $2, $3, $4::uuid[]);
`;

export const DELETE_SAVED_HAND = `
  DELETE FROM geo.saved_hands WHERE player_id = $1 AND id = $2;
`;

export const ADD_SKILL_XP = `
  INSERT INTO geo.skill_xp (player_id, skill, xp) VALUES ($1, $2, $3)
  ON CONFLICT (player_id, skill) DO UPDATE SET xp = geo.skill_xp.xp + EXCLUDED.xp;
`;

/** Takes coins only if there are enough; no row back means there weren't. */
/** Purse → bank, only if the purse holds that much. */
export const BANK_DEPOSIT = `
  UPDATE geo.players SET coins = coins - $2, bank_coins = bank_coins + $2
  WHERE id = $1 AND coins >= $2 RETURNING coins;
`;

/** Bank → purse, only if the bank holds that much. */
export const BANK_WITHDRAW = `
  UPDATE geo.players SET coins = coins + $2, bank_coins = bank_coins - $2
  WHERE id = $1 AND bank_coins >= $2 RETURNING coins;
`;

export const SPEND_COINS = `
  UPDATE geo.players SET coins = coins - $2 WHERE id = $1 AND coins >= $2 RETURNING coins;
`;

/** Locks one owned row, so two sales of it at once can't both take it. */
export const LOCK_INVENTORY_ROW = `
  SELECT id, player_id, item_id, quantity, charges_left, reforge, pet, obtained_at
  FROM geo.inventory WHERE player_id = $1 AND id = $2 FOR UPDATE;
`;

export const DELETE_INVENTORY_ROW = `
  DELETE FROM geo.inventory WHERE player_id = $1 AND id = $2;
`;

export const TAKE_FROM_STACK = `
  UPDATE geo.inventory SET quantity = quantity - $3 WHERE player_id = $1 AND id = $2;
`;

/** Puts a copy back exactly as it was: same id, same obtained date. */
export const RESTORE_INVENTORY_ROW = `
  INSERT INTO geo.inventory (id, player_id, item_id, quantity, charges_left, obtained_at, reforge, pet)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (id) DO NOTHING
  RETURNING id;
`;

/**
 * Locks every row of one item the player has free to spend (not worn, bagged,
 * in a hand or the active pet), oldest first.
 */
export const LOCK_FREE_ROWS_OF_ITEM = `
  SELECT i.id, i.player_id, i.item_id, i.quantity, i.charges_left, i.reforge, i.pet, i.obtained_at
  FROM geo.inventory i
  WHERE i.player_id = $1 AND i.item_id = $2
    AND NOT EXISTS (SELECT 1 FROM geo.equipment e WHERE e.player_id = $1 AND e.inventory_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM geo.talisman_bag b WHERE b.player_id = $1 AND b.inventory_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM geo.hands h WHERE h.player_id = $1 AND i.id = ANY(h.inventory_ids))
    AND NOT EXISTS (SELECT 1 FROM geo.active_pets a WHERE a.player_id = $1 AND a.inventory_id = i.id)
  ORDER BY i.obtained_at
  FOR UPDATE OF i;
`;

/** Where an inventory row is in use: worn, bagged, in a hand, or the active pet. */
export const FIND_USES = `
  SELECT
    EXISTS (SELECT 1 FROM geo.equipment WHERE player_id = $1 AND inventory_id = $2) AS equipped,
    EXISTS (SELECT 1 FROM geo.talisman_bag WHERE player_id = $1 AND inventory_id = $2) AS bagged,
    EXISTS (SELECT 1 FROM geo.hands WHERE player_id = $1 AND $2 = ANY(inventory_ids)) AS in_hand,
    EXISTS (SELECT 1 FROM geo.active_pets WHERE player_id = $1 AND inventory_id = $2) AS active_pet;
`;

/** The active pet's inventory row, if there is one. */
export const FIND_ACTIVE_PET = `
  SELECT i.id, i.player_id, i.item_id, i.quantity, i.charges_left, i.reforge, i.pet, i.obtained_at
  FROM geo.active_pets a JOIN geo.inventory i ON i.id = a.inventory_id AND i.player_id = a.player_id
  WHERE a.player_id = $1;
`;

export const SET_ACTIVE_PET = `
  INSERT INTO geo.active_pets (player_id, inventory_id) VALUES ($1, $2)
  ON CONFLICT (player_id) DO UPDATE SET inventory_id = EXCLUDED.inventory_id;
`;

export const CLEAR_ACTIVE_PET = `
  DELETE FROM geo.active_pets WHERE player_id = $1;
`;

/** Adds XP to a pet copy in one statement, so two gains at once both count. */
export const ADD_PET_XP = `
  UPDATE geo.inventory
  SET pet = jsonb_set(COALESCE(pet, '{"xp": 0, "heldItem": null}'), '{xp}', to_jsonb(COALESCE((pet->>'xp')::float8, 0) + $3))
  WHERE player_id = $1 AND id = $2;
`;

/** Sets only the held item ($3 JSON: an item id or null). No row back means the copy is no longer the player's. */
export const SET_PET_HELD_ITEM = `
  UPDATE geo.inventory
  SET pet = jsonb_set(COALESCE(pet, '{"xp": 0, "heldItem": null}'), '{heldItem}', $3::jsonb)
  WHERE player_id = $1 AND id = $2
  RETURNING id;
`;

/** The pet left with Kat, if any. */
export const FIND_PET_UPGRADE = `
  SELECT inventory_id, item_id, to_item_id, pet, obtained_at, ready_at FROM geo.pet_upgrades WHERE player_id = $1;
`;

export const INSERT_PET_UPGRADE = `
  INSERT INTO geo.pet_upgrades (player_id, inventory_id, item_id, to_item_id, pet, obtained_at, ready_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7);
`;

/** Hands the pet back: no row back means there was none (or it was already collected). */
export const DELETE_PET_UPGRADE = `
  DELETE FROM geo.pet_upgrades WHERE player_id = $1
  RETURNING inventory_id, item_id, to_item_id, pet, obtained_at, ready_at;
`;

/** Health carried between fights (NULL is full) and camp, rounded. */
export const FIND_HEALTH_AND_CAMP = `
  SELECT health, camp_latitude, camp_longitude, camp_set_at FROM geo.players WHERE id = $1;
`;

/** $2 NULL is full health. */
export const SET_HEALTH = `
  UPDATE geo.players SET health = $2 WHERE id = $1;
`;

export const SET_CAMP = `
  UPDATE geo.players SET camp_latitude = $2, camp_longitude = $3, camp_set_at = now() WHERE id = $1;
`;

/** Forgets the point but not when it was set: the move limit still holds. */
export const CLEAR_CAMP = `
  UPDATE geo.players SET camp_latitude = NULL, camp_longitude = NULL WHERE id = $1;
`;
