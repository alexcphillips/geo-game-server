// From server/src/modules/wardrobe/geo-wardrobe.sql.ts. Postgres's
// CTE-wrapped writes are split into one statement each (the caller's
// transaction holds them together); jsonb_object_agg is json_group_object.

export const FIND_WARDROBE_STATE = `SELECT wardrobe_bought, active_loadout FROM players WHERE id = ?;`;

export const FIND_LOADOUTS = `
  SELECT slot, name, equipment, pet_id, auto_for FROM loadouts WHERE player_id = ? ORDER BY slot;
`;

export const FIND_LOADOUT = `
  SELECT slot, name, equipment, pet_id, auto_for FROM loadouts WHERE player_id = ? AND slot = ?;
`;

/** Of these inventory ids (? 2, a JSON array), the ones the player still owns, with what they are. */
export const FIND_OWNED = `
  SELECT id, item_id FROM inventory WHERE player_id = ? AND id IN (SELECT value FROM json_each(?));
`;

/** What's worn now, gear and pet, as a loadout stores it. Each takes the player id once. */
const WORN_EQUIPMENT = `(SELECT json_group_object(slot, inventory_id) FROM equipment WHERE player_id = ?)`;
const WORN_PET = `(SELECT inventory_id FROM active_pets WHERE player_id = ?)`;

/** Saves what's worn into the slot, keeping its auto tag. ? player, slot, name, player, player. */
export const SAVE_WORN = `
  INSERT INTO loadouts (player_id, slot, name, equipment, pet_id)
  VALUES (?, ?, ?, ${WORN_EQUIPMENT}, ${WORN_PET})
  ON CONFLICT (player_id, slot) DO UPDATE
    SET name = excluded.name, equipment = excluded.equipment, pet_id = excluded.pet_id;
`;

/** Brings the active loadout up to date with what's worn; nothing when none is active. ? player ×4. */
export const SYNC_ACTIVE = `
  UPDATE loadouts SET equipment = ${WORN_EQUIPMENT}, pet_id = ${WORN_PET}
  WHERE player_id = ? AND slot = (SELECT active_loadout FROM players WHERE id = ?);
`;

export const INSERT_LOADOUT = `
  INSERT INTO loadouts (player_id, slot, name, equipment, pet_id, auto_for) VALUES (?, ?, ?, ?, ?, ?);
`;

export const RENAME_LOADOUT = `UPDATE loadouts SET name = ? WHERE player_id = ? AND slot = ? RETURNING slot;`;

export const DELETE_LOADOUT = `DELETE FROM loadouts WHERE player_id = ? AND slot = ?;`;

/** After DELETE_LOADOUT: the active mark goes if it pointed there. */
export const UNSET_ACTIVE = `UPDATE players SET active_loadout = NULL WHERE id = ? AND active_loadout = ?;`;

export const SET_ACTIVE = `UPDATE players SET active_loadout = ? WHERE id = ?;`;

/** Takes the tag off whichever loadout had it, before it goes on another. */
export const CLEAR_AUTO_FOR = `UPDATE loadouts SET auto_for = NULL WHERE player_id = ? AND auto_for = ?;`;

export const SET_AUTO_FOR = `UPDATE loadouts SET auto_for = ? WHERE player_id = ? AND slot = ? RETURNING slot;`;

/** The item held in the main hand, if any. */
export const FIND_MAIN_HAND_ITEM = `
  SELECT i.item_id FROM equipment e JOIN inventory i ON i.player_id = e.player_id AND i.id = e.inventory_id
  WHERE e.player_id = ? AND e.slot = 'mainHand';
`;

export const ADD_BOUGHT_SLOT = `UPDATE players SET wardrobe_bought = wardrobe_bought + 1 WHERE id = ?;`;
