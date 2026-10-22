const ADMIN_PLAYER_COLUMNS = `p.id, p.display_name, p.email, p.role, p.coins, p.banned_at, p.created_at`;

/** Everyone, newest first (admin only). */
export const FIND_ALL_PLAYERS = `
  SELECT ${ADMIN_PLAYER_COLUMNS} FROM players p ORDER BY p.created_at DESC LIMIT 200;
`;

/** Name or email containing `?` (a LIKE pattern, `\\` escaping), newest first (admin only). */
export const SEARCH_PLAYERS = `
  SELECT ${ADMIN_PLAYER_COLUMNS} FROM players p
  WHERE p.display_name LIKE ?1 ESCAPE '\\' OR p.email LIKE ?1 ESCAPE '\\'
  ORDER BY p.created_at DESC LIMIT 200;
`;

export const FIND_ADMIN_PLAYER = `SELECT ${ADMIN_PLAYER_COLUMNS} FROM players p WHERE p.id = ?;`;

/** A player's latest movements. Uses `coin_ledger_player`. */
export const FIND_LEDGER = `
  SELECT delta, reason, reference, created_at
  FROM coin_ledger WHERE player_id = ?
  ORDER BY created_at DESC, id DESC LIMIT 100;
`;

export const SET_ROLE = `UPDATE players SET role = ? WHERE id = ? RETURNING id;`;

/** Banned at `?` (null to lift it). */
export const SET_BANNED = `UPDATE players SET banned_at = ? WHERE id = ? RETURNING id;`;

/** Who to make an admin: the first one, by the ops secret. Uses `players_email_key`. */
export const SET_ROLE_BY_EMAIL = `
  UPDATE players SET role = ? WHERE lower(email) = lower(?) RETURNING id, display_name;
`;

export const INSERT_AUDIT = `
  INSERT INTO admin_actions (admin_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?);
`;

/** Newest first: ids rise with time. */
export const FIND_AUDIT = `
  SELECT a.id, coalesce(p.display_name, 'deleted admin') AS admin, a.action, a.target, a.details, a.created_at
  FROM admin_actions a LEFT JOIN players p ON p.id = a.admin_id
  ORDER BY a.id DESC LIMIT 200;
`;

export const SUM_PURSES = `SELECT coalesce(sum(coins), 0) AS total FROM players;`;

/** Since `?` (a day ago). */
export const LEDGER_LAST_DAY = `
  SELECT reason, sum(delta) AS delta, count(*) AS count
  FROM coin_ledger WHERE created_at > ?
  GROUP BY reason ORDER BY reason;
`;

/** Players whose purse disagrees with their ledger. */
export const LEDGER_MISMATCHES = `
  SELECT p.id, p.display_name, p.coins, coalesce(l.total, 0) AS ledger
  FROM players p
  LEFT JOIN (SELECT player_id, sum(delta) AS total FROM coin_ledger GROUP BY player_id) l ON l.player_id = p.id
  WHERE p.coins <> coalesce(l.total, 0)
  LIMIT 50;
`;

export const FIND_ALWAYS_SEA_CREATURES = `SELECT always_sea_creatures FROM players WHERE id = ?;`;

export const SET_ALWAYS_SEA_CREATURES = `UPDATE players SET always_sea_creatures = ? WHERE id = ?;`;
