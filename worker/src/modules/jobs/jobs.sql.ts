/** Books `key` for a time, or moves it. Writes nothing when the time is already that. */
export const SET_DUE = `
  INSERT INTO due (key, at) VALUES (?, ?)
  ON CONFLICT (key) DO UPDATE SET at = excluded.at WHERE due.at <> excluded.at;
`;

/** Books `key` unless it's booked already: the jobs that always come back. */
export const ADD_DUE = `INSERT INTO due (key, at) VALUES (?, ?) ON CONFLICT (key) DO NOTHING;`;

export const CLEAR_DUE = `DELETE FROM due WHERE key = ?;`;

export const FIND_DUE_AT = `SELECT at FROM due WHERE key = ?;`;

/** What's due by $1, soonest first, at most $2. */
export const FIND_DUE = `SELECT key, at FROM due WHERE at <= ? ORDER BY at LIMIT ?;`;

/** When the alarm should next go off; null with nothing booked. */
export const NEXT_DUE = `SELECT min(at) AS at FROM due;`;

/** Refresh tokens a week past expiry or revocation ($1: a week ago), kept that long so a reused one still reads as stolen. */
export const DELETE_OLD_REFRESH_TOKENS = `
  DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked_at < ?;
`;
