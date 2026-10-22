/** Since when a player who dropped mid-party has been gone (ms). */
export const FIND_GONE = `SELECT since FROM gone WHERE player_id = ?;`;

export const SET_GONE = `INSERT INTO gone (player_id, since) VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET since = excluded.since;`;

/** Writes nothing when there's no row. */
export const CLEAR_GONE = `DELETE FROM gone WHERE player_id = ?;`;
