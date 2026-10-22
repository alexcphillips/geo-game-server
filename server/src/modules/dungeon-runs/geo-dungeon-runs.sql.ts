const RUN_COLUMNS = `id, dungeon_id, status, map, state, version`;

/** The dungeon run the player is still in, if any. */
export const FIND_ACTIVE_RUN_ID = `
  SELECT dungeon_run_id AS id FROM geo.dungeon_run_members WHERE player_id = $1 AND status = 'active';
`;

export const FIND_DUNGEON_RUN = `
  SELECT ${RUN_COLUMNS} FROM geo.dungeon_runs WHERE id = $1;
`;

/** Locks the party's run: every change to it, anyone's, goes through this row. */
export const FIND_DUNGEON_RUN_FOR_UPDATE = `
  SELECT ${RUN_COLUMNS} FROM geo.dungeon_runs WHERE id = $1 FOR UPDATE;
`;

/** Who's in the run, for locking them all (in id order) before the run itself. */
export const FIND_MEMBER_IDS = `
  SELECT player_id FROM geo.dungeon_run_members WHERE dungeon_run_id = $1 ORDER BY player_id;
`;

/** Everyone who went in, in lobby order. */
export const FIND_MEMBERS = `
  SELECT m.player_id, p.display_name, m.status, m.state
  FROM geo.dungeon_run_members m
  JOIN geo.players p ON p.id = m.player_id
  WHERE m.dungeon_run_id = $1
  ORDER BY m.seat;
`;

export const INSERT_DUNGEON_RUN = `
  INSERT INTO geo.dungeon_runs (dungeon_id, lobby_id, map, state)
  VALUES ($1, $2, $3::jsonb, $4::jsonb)
  RETURNING ${RUN_COLUMNS};
`;

export const INSERT_MEMBER = `
  INSERT INTO geo.dungeon_run_members (dungeon_run_id, player_id, state, seat)
  VALUES ($1, $2, $3::jsonb, $4);
`;

/** Saves the party's side and when it next needs waking ($4, ms or null), and moves the version on. */
export const UPDATE_DUNGEON_RUN = `
  UPDATE geo.dungeon_runs
  SET status = $2::text, state = $3::jsonb, version = version + 1, updated_at = now(),
      wake_at = CASE WHEN $4::bigint IS NULL THEN NULL ELSE to_timestamp($4::bigint / 1000.0) END,
      ended_at = CASE WHEN $2::text = 'active' THEN NULL ELSE COALESCE(ended_at, now()) END
  WHERE id = $1
  RETURNING version;
`;

/** Books the next wake ($2, ms or null) without counting as a change. */
export const SET_WAKE = `
  UPDATE geo.dungeon_runs
  SET wake_at = CASE WHEN $2::bigint IS NULL THEN NULL ELSE to_timestamp($2::bigint / 1000.0) END
  WHERE id = $1;
`;

/** Runs whose wake is due, for the job that catches what a restart's timers dropped. */
export const FIND_DUE_RUNS = `
  SELECT id FROM geo.dungeon_runs WHERE status = 'active' AND wake_at <= now() LIMIT 100;
`;

export const UPDATE_MEMBER = `
  UPDATE geo.dungeon_run_members
  SET status = $3::text, state = $4::jsonb,
      ended_at = CASE WHEN $3::text = 'active' THEN NULL ELSE COALESCE(ended_at, now()) END
  WHERE dungeon_run_id = $1 AND player_id = $2;
`;

/** A room fight's status and how much health it left, for a fight that ended outside the dungeon's own hooks. */
export const FIND_FIGHT = `
  SELECT status, state FROM geo.runs WHERE id = $1;
`;

/** Ends a room fight still going when the dungeon is left. */
export const END_FIGHT = `
  UPDATE geo.runs SET status = 'fled', updated_at = now(), ended_at = now() WHERE id = $1 AND status = 'active';
`;
