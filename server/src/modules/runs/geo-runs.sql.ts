const RUN_COLUMNS = `id, player_id, kind, status, enemy_ids, spawn_id, state, rewards, coins_lost, keeps_health, dungeon_id, dungeon_run_id, dungeon_room,
  battle_id, combatant_id, turn_started_at, turn_deadline, version`;

export const FIND_ACTIVE_RUN = `
  SELECT ${RUN_COLUMNS} FROM geo.runs WHERE player_id = $1 AND status = 'active';
`;

/** The Run in progress, locked, for ending it from outside the fight. */
export const FIND_ACTIVE_RUN_FOR_UPDATE = `
  SELECT ${RUN_COLUMNS} FROM geo.runs WHERE player_id = $1 AND status = 'active' FOR UPDATE;
`;

/** Locks the Run, so two taps on a card can't both resolve. */
export const FIND_RUN_FOR_UPDATE = `
  SELECT ${RUN_COLUMNS} FROM geo.runs WHERE id = $1 AND player_id = $2 FOR UPDATE;
`;

/**
 * A Run untouched this long is treated as fled: the app was closed mid-fight.
 * Checked lazily, whenever the player next looks at or starts a Run.
 */
export const ABANDON_STALE_RUNS = `
  UPDATE geo.runs SET status = 'fled', ended_at = now()
  WHERE player_id = $1 AND status = 'active'
    AND updated_at < now() - make_interval(mins => $2);
`;

export const INSERT_RUN = `
  INSERT INTO geo.runs (player_id, kind, enemy_ids, spawn_id, state, keeps_health, dungeon_id, dungeon_run_id, dungeon_room)
  VALUES ($1, $2, $3::text[], $4, $5::jsonb, $6, $7, $8, $9)
  RETURNING ${RUN_COLUMNS};
`;

/** One player's row of a shared fight: as INSERT_RUN, plus the battle ($10) and their combatant in it ($11). */
export const INSERT_BATTLE_RUN = `
  INSERT INTO geo.runs (player_id, kind, enemy_ids, spawn_id, state, keeps_health, dungeon_id, dungeon_run_id, dungeon_room,
                        battle_id, combatant_id)
  VALUES ($1, $2, $3::text[], $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
  RETURNING ${RUN_COLUMNS};
`;

export const UPDATE_RUN = `
  UPDATE geo.runs
  SET state = $2::jsonb, status = $3::text, rewards = $4::jsonb, coins_lost = $5, updated_at = now(), version = version + 1,
      ended_at = CASE WHEN $3::text = 'active' THEN NULL ELSE COALESCE(ended_at, now()) END
  WHERE id = $1;
`;

/** The Run, unlocked, to see whether it's shared before locking. */
export const FIND_RUN = `
  SELECT ${RUN_COLUMNS} FROM geo.runs WHERE id = $1 AND player_id = $2;
`;

/** Who's in a shared fight, in id order, for locking them all. */
export const FIND_BATTLE_PLAYERS = `
  SELECT player_id FROM geo.runs WHERE battle_id = $1 ORDER BY player_id;
`;

/** Every player's row of a shared fight, locked, in id order. */
export const FIND_BATTLE_ROWS_FOR_UPDATE = `
  SELECT ${RUN_COLUMNS} FROM geo.runs WHERE battle_id = $1 ORDER BY player_id FOR UPDATE;
`;

/** A shared fight's turn clock, on every player's row: $2 when the turn began, $3 when it's skipped (ms; null = no clock). */
export const SET_TURN_CLOCK = `
  UPDATE geo.runs
  SET turn_started_at = to_timestamp($2::bigint / 1000.0),
      turn_deadline = CASE WHEN $3::bigint IS NULL THEN NULL ELSE to_timestamp($3::bigint / 1000.0) END
  WHERE battle_id = $1;
`;

/** Shared fights whose turn clock has run out: the job's catch for timers a restart dropped. */
export const FIND_DUE_BATTLES = `
  SELECT DISTINCT battle_id FROM geo.runs
  WHERE battle_id IS NOT NULL AND status = 'active' AND turn_deadline <= now()
  LIMIT 100;
`;

/** The shared fight the player is still in, if any. */
/** The player's latest shared fight: still going, or ended within $2 minutes. */
export const FIND_RECENT_SHARED_RUN = `
  SELECT ${RUN_COLUMNS} FROM geo.runs
  WHERE player_id = $1 AND battle_id IS NOT NULL
    AND (status = 'active' OR ended_at > now() - make_interval(mins => $2))
  ORDER BY created_at DESC
  LIMIT 1;
`;

export const FIND_PLAYER_BATTLE = `
  SELECT battle_id FROM geo.runs WHERE player_id = $1 AND status = 'active' AND battle_id IS NOT NULL;
`;
