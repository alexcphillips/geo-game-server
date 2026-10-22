/** Holds the player row, so two world requests can't both top up spawns. */
export const LOCK_PLAYER = `SELECT id FROM geo.players WHERE id = $1 FOR UPDATE;`;

export const FIND_SPAWNS = `
  SELECT id, enemy_id, latitude, longitude, despawns_at, claimed_at, out_of_reach_since, created_at
  FROM geo.spawns WHERE player_id = $1;
`;

export const DELETE_SPAWNS = `
  DELETE FROM geo.spawns WHERE player_id = $1 AND id = ANY($2::uuid[]);
`;

export const INSERT_SPAWN = `
  INSERT INTO geo.spawns (player_id, enemy_id, latitude, longitude, despawns_at, created_at)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id, enemy_id, latitude, longitude, despawns_at, claimed_at, out_of_reach_since, created_at;
`;

/** A spawn that can still be fought: this player's, unbeaten, not gone. */
export const FIND_LIVE_SPAWN = `
  SELECT id, enemy_id, latitude, longitude, despawns_at, claimed_at, out_of_reach_since, created_at
  FROM geo.spawns
  WHERE player_id = $1 AND id = $2 AND claimed_at IS NULL AND despawns_at > now();
`;

export const CLAIM_SPAWN = `
  UPDATE geo.spawns SET claimed_at = now() WHERE player_id = $1 AND id = $2;
`;

/** Starts (or, with null, stops) the out-of-reach countdown. */
export const SET_OUT_OF_REACH = `
  UPDATE geo.spawns SET out_of_reach_since = $3
  WHERE player_id = $1 AND id = ANY($2::uuid[])
  RETURNING id, out_of_reach_since;
`;

export const FIND_TRAVEL = `
  SELECT latitude, longitude, seen_at, banked_metres, last_spawned_at FROM geo.player_travel WHERE player_id = $1;
`;

export const SAVE_TRAVEL = `
  INSERT INTO geo.player_travel (player_id, latitude, longitude, seen_at, banked_metres, last_spawned_at)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (player_id) DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    seen_at = EXCLUDED.seen_at,
    banked_metres = EXCLUDED.banked_metres,
    last_spawned_at = EXCLUDED.last_spawned_at;
`;
