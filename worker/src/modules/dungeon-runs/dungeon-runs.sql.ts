const RUN_COLUMNS = `id, dungeon_id, status, map, state, version`;

/** The dungeon run the player is still in, if any. Uses `dungeon_run_members_one_active`. */
export const FIND_ACTIVE_RUN_ID = `
  SELECT dungeon_run_id AS id FROM dungeon_run_members WHERE player_id = ? AND status = 'active';
`;

export const FIND_DUNGEON_RUN = `SELECT ${RUN_COLUMNS} FROM dungeon_runs WHERE id = ?;`;

/** Everyone who went in, in lobby order. */
export const FIND_MEMBERS = `
  SELECT m.player_id, p.display_name, m.status, m.state
  FROM dungeon_run_members m
  JOIN players p ON p.id = m.player_id
  WHERE m.dungeon_run_id = ?
  ORDER BY m.seat;
`;

export const INSERT_DUNGEON_RUN = `
  INSERT INTO dungeon_runs (id, dungeon_id, lobby_id, map, state, created_at, updated_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
  RETURNING ${RUN_COLUMNS};
`;

export const INSERT_MEMBER = `
  INSERT INTO dungeon_run_members (dungeon_run_id, player_id, state, seat) VALUES (?, ?, ?, ?);
`;

/** Saves the party's side and moves the version on. ?2: the status; ?4: now. */
export const UPDATE_DUNGEON_RUN = `
  UPDATE dungeon_runs
  SET status = ?2, state = ?3, version = version + 1, updated_at = ?4,
      ended_at = CASE WHEN ?2 = 'active' THEN NULL ELSE coalesce(ended_at, ?4) END
  WHERE id = ?1
  RETURNING version;
`;

/** Saves a member whose status changed. ?3: the status; ?5: now. */
export const UPDATE_MEMBER = `
  UPDATE dungeon_run_members
  SET status = ?3, state = ?4, ended_at = CASE WHEN ?3 = 'active' THEN NULL ELSE coalesce(ended_at, ?5) END
  WHERE dungeon_run_id = ?1 AND player_id = ?2;
`;

/**
 * Saves a member whose status didn't change. Leaves `status` alone: setting
 * it rewrites their `dungeon_run_members_one_active` entry, a second write.
 */
export const UPDATE_MEMBER_STATE = `UPDATE dungeon_run_members SET state = ? WHERE dungeon_run_id = ? AND player_id = ?;`;

/** A room fight's status and battle, for one that ended outside the dungeon's own hooks. */
export const FIND_FIGHT = `SELECT status, state FROM runs WHERE id = ?;`;

/** Ends a room fight still going when the dungeon is left. */
export const END_FIGHT = `
  UPDATE runs SET status = 'fled', updated_at = ?1, ended_at = ?1 WHERE id = ?2 AND status = 'active';
`;
