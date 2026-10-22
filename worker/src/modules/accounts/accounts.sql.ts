// Imported as `./accounts.sql.ts`, with the extension: wrangler treats an import ending in
// `.sql` as a raw text file, and that built-in rule can't be switched off.
const PLAYER_COLUMNS = `id, display_name, coins, bank_coins, role, created_at`;

/** Signing in: the player and their password hash. Uses `players_email_key`. */
export const FIND_CREDENTIALS_BY_EMAIL = `
  SELECT ${PLAYER_COLUMNS}, password_hash FROM players WHERE lower(email) = lower(?);
`;

/** Sign-up's checks, in the same transaction as the insert. */
export const EMAIL_TAKEN = `SELECT 1 AS taken FROM players WHERE lower(email) = lower(?);`;
export const DISPLAY_NAME_TAKEN = `SELECT 1 AS taken FROM players WHERE lower(display_name) = lower(?);`;

export const INSERT_PLAYER = `
  INSERT INTO players (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)
  RETURNING ${PLAYER_COLUMNS};
`;

export const FIND_PLAYER = `SELECT ${PLAYER_COLUMNS} FROM players WHERE id = ?;`;

export const INSERT_REFRESH_TOKEN = `
  INSERT INTO refresh_tokens (token_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?);
`;

export const FIND_REFRESH_TOKEN = `
  SELECT token_hash, player_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?;
`;

export const REVOKE_REFRESH_TOKEN = `UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?;`;

/** Signing out: that one token, whoever holds it. */
export const REVOKE_REFRESH_TOKEN_BY_HASH = `
  UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL;
`;

/** A reused token means it leaked: end every session for that player. */
export const REVOKE_ALL_FOR_PLAYER = `
  UPDATE refresh_tokens SET revoked_at = ? WHERE player_id = ? AND revoked_at IS NULL;
`;
