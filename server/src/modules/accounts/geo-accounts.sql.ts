const PLAYER_COLUMNS = `id, display_name, coins, bank_coins, role, created_at`;

/** Signing in: the player and their password hash, to check against. */
export const FIND_CREDENTIALS_BY_EMAIL = `
  SELECT ${PLAYER_COLUMNS}, password_hash FROM geo.players WHERE lower(email) = lower($1);
`;

/** Fails on a taken email or name (unique indexes); the caller says which. */
export const INSERT_PLAYER = `
  INSERT INTO geo.players (email, password_hash, display_name) VALUES ($1, $2, $3)
  RETURNING ${PLAYER_COLUMNS};
`;

export const INSERT_REFRESH_TOKEN = `
  INSERT INTO geo.refresh_tokens (player_id, token_hash, expires_at)
  VALUES ($1, $2, now() + make_interval(days => $3));
`;

/** Locks the row, so two refreshes racing with one token can't both win. */
export const FIND_REFRESH_TOKEN_FOR_UPDATE = `
  SELECT id, player_id, expires_at, revoked_at
  FROM geo.refresh_tokens WHERE token_hash = $1 FOR UPDATE;
`;

export const REVOKE_REFRESH_TOKEN = `
  UPDATE geo.refresh_tokens SET revoked_at = now() WHERE id = $1;
`;

/** Signing out: that one token, whoever holds it. */
export const REVOKE_REFRESH_TOKEN_BY_HASH = `
  UPDATE geo.refresh_tokens SET revoked_at = now()
  WHERE token_hash = $1 AND revoked_at IS NULL;
`;

/** A reused token means it leaked: end every session for that player. */
export const REVOKE_ALL_FOR_PLAYER = `
  UPDATE geo.refresh_tokens SET revoked_at = now()
  WHERE player_id = $1 AND revoked_at IS NULL;
`;
