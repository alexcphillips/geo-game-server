// From server/src/modules/world/geo-world.sql.ts. Travel and the
// out-of-reach countdown are in World memory, so only spawns are here.

const SPAWN_COLUMNS = `id, enemy_id, latitude, longitude, despawns_at, claimed_at, created_at`;

export const FIND_SPAWNS = `SELECT ${SPAWN_COLUMNS} FROM spawns WHERE player_id = ?;`;

/** ? 2: a JSON array of ids. */
export const DELETE_SPAWNS = `
  DELETE FROM spawns WHERE player_id = ? AND id IN (SELECT value FROM json_each(?));
`;

export const INSERT_SPAWN = `
  INSERT INTO spawns (player_id, id, enemy_id, latitude, longitude, despawns_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  RETURNING ${SPAWN_COLUMNS};
`;

/** A spawn that can still be fought: this player's, unbeaten, not past its lifetime (? 3: now). */
export const FIND_LIVE_SPAWN = `
  SELECT ${SPAWN_COLUMNS} FROM spawns
  WHERE player_id = ? AND id = ? AND claimed_at IS NULL AND despawns_at > ?;
`;

export const CLAIM_SPAWN = `UPDATE spawns SET claimed_at = ? WHERE player_id = ? AND id = ?;`;
