const ADMIN_PLAYER_COLUMNS = `
  p.id, p.display_name, p.email, p.role, p.coins, p.banned_at, p.created_at
`;

/** Newest first. `$1` filters by name or email, or is null for everyone. */
export const FIND_PLAYERS = `
  SELECT ${ADMIN_PLAYER_COLUMNS}
  FROM geo.players p
  WHERE $1::text IS NULL OR p.display_name ILIKE $1 OR p.email ILIKE $1
  ORDER BY p.created_at DESC
  LIMIT 200;
`;

export const FIND_ADMIN_PLAYER = `
  SELECT ${ADMIN_PLAYER_COLUMNS}
  FROM geo.players p
  WHERE p.id = $1;
`;

export const FIND_LEDGER = `
  SELECT delta, reason, reference, created_at
  FROM geo.coin_ledger WHERE player_id = $1
  ORDER BY created_at DESC, id DESC LIMIT 100;
`;

export const SET_ROLE = `UPDATE geo.players SET role = $2 WHERE id = $1 RETURNING id;`;

export const SET_BANNED = `
  UPDATE geo.players SET banned_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1 RETURNING id;
`;

/** Locks the player, so a grant and a purchase can't race. */
export const LOCK_PLAYER_COINS = `SELECT coins FROM geo.players WHERE id = $1 FOR UPDATE;`;

export const INSERT_AUDIT = `
  INSERT INTO geo.admin_actions (admin_id, action, target, details) VALUES ($1, $2, $3, $4);
`;

export const FIND_AUDIT = `
  SELECT a.id, COALESCE(p.display_name, 'deleted admin') AS admin, a.action, a.target, a.details, a.created_at
  FROM geo.admin_actions a LEFT JOIN geo.players p ON p.id = a.admin_id
  ORDER BY a.created_at DESC, a.id DESC LIMIT 200;
`;

export const SUM_PURSES = `SELECT COALESCE(SUM(coins), 0) AS total FROM geo.players;`;

export const LEDGER_LAST_DAY = `
  SELECT reason, SUM(delta) AS delta, COUNT(*) AS count
  FROM geo.coin_ledger WHERE created_at > now() - interval '24 hours'
  GROUP BY reason ORDER BY reason;
`;

/** Players whose purse disagrees with their ledger. */
export const LEDGER_MISMATCHES = `
  SELECT p.id, p.display_name, p.coins, COALESCE(l.total, 0) AS ledger
  FROM geo.players p
  LEFT JOIN (SELECT player_id, SUM(delta) AS total FROM geo.coin_ledger GROUP BY player_id) l
    ON l.player_id = p.id
  WHERE p.coins <> COALESCE(l.total, 0)
  LIMIT 50;
`;

/** The admin's own "every bite is a sea creature" switch. */
export const FIND_ALWAYS_SEA_CREATURES = `
  SELECT always_sea_creatures FROM geo.players WHERE id = $1;
`;

export const SET_ALWAYS_SEA_CREATURES = `
  UPDATE geo.players SET always_sea_creatures = $2 WHERE id = $1;
`;
