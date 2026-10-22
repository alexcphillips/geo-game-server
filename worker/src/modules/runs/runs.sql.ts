const RUN_COLUMNS = `id, player_id, kind, status, enemy_ids, spawn_id, state, rewards, coins_lost, keeps_health, dungeon_id, dungeon_run_id, dungeon_room,
  battle_id, combatant_id, turn_started_at, turn_deadline, version`;

/** The Run in progress, if any. Uses `runs_one_active`. */
export const FIND_ACTIVE_RUN = `SELECT ${RUN_COLUMNS} FROM runs WHERE player_id = ? AND status = 'active';`;

export const FIND_RUN = `SELECT ${RUN_COLUMNS} FROM runs WHERE id = ? AND player_id = ?;`;

/**
 * Ends the player's Run if it's gone untouched since ?3: the app was closed
 * mid-fight. Checked lazily, whenever the player next does something a Run
 * could get in the way of. Writes only when there's one to end.
 */
export const ABANDON_STALE_RUN = `
  UPDATE runs SET status = 'fled', ended_at = ?1
  WHERE player_id = ?2 AND status = 'active' AND updated_at < ?3;
`;

export const INSERT_RUN = `
  INSERT INTO runs (id, player_id, kind, enemy_ids, spawn_id, state, keeps_health, dungeon_id, dungeon_run_id, dungeon_room,
                    battle_id, combatant_id, created_at, updated_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
  RETURNING ${RUN_COLUMNS};
`;

/**
 * Saves a step that leaves the Run going. Leaves `status` alone: setting it,
 * even to the same value, rewrites the row's `runs_one_active` entry, a
 * second write every turn.
 */
export const UPDATE_RUN_STATE = `UPDATE runs SET state = ?, updated_at = ?, version = version + 1 WHERE id = ?;`;

/** Saves a step, status and all. ?3: the status; ?6: now. */
export const UPDATE_RUN = `
  UPDATE runs
  SET state = ?2, status = ?3, rewards = ?4, coins_lost = ?5, updated_at = ?6, version = version + 1,
      ended_at = CASE WHEN ?3 = 'active' THEN NULL ELSE coalesce(ended_at, ?6) END
  WHERE id = ?1;
`;

/** Every player's row of a shared fight, in id order. Uses `runs_battle`. */
export const FIND_BATTLE_ROWS = `SELECT ${RUN_COLUMNS} FROM runs WHERE battle_id = ? ORDER BY player_id;`;

/** A shared fight's turn clock, on every player's row: when the turn began, and when it's skipped (null: no clock). */
export const SET_TURN_CLOCK = `UPDATE runs SET turn_started_at = ?, turn_deadline = ? WHERE battle_id = ?;`;
