/** A lobby with its host's name and head count. */
const LOBBY_SELECT = `
  SELECT l.id, l.dungeon_id, l.host_id, host.display_name AS host_name, l.required_level, l.max_players,
         l.created_at, l.started_at, l.closed_at,
         (SELECT count(*) FROM dungeon_lobby_members m WHERE m.lobby_id = l.id) AS player_count
  FROM dungeon_lobbies l
  JOIN players host ON host.id = l.host_id
`;

/** Lobbies waiting for their host to start them, newest first, at most ?. Uses `dungeon_lobbies_open`. */
export const LIST_OPEN_LOBBIES = `
  ${LOBBY_SELECT}
  WHERE l.closed_at IS NULL AND l.started_at IS NULL
  ORDER BY l.created_at DESC
  LIMIT ?;
`;

/** The open lobby the player is in, if any. */
export const FIND_PLAYER_LOBBY = `
  ${LOBBY_SELECT}
  JOIN dungeon_lobby_members me ON me.lobby_id = l.id AND me.player_id = ?
  WHERE l.closed_at IS NULL AND l.started_at IS NULL
  ORDER BY me.joined_at DESC
  LIMIT 1;
`;

export const FIND_LOBBY = `
  ${LOBBY_SELECT}
  WHERE l.id = ?;
`;

export const FIND_MEMBERS = `
  SELECT m.player_id, p.display_name
  FROM dungeon_lobby_members m
  JOIN players p ON p.id = m.player_id
  WHERE m.lobby_id = ?
  ORDER BY m.joined_at;
`;

export const INSERT_LOBBY = `
  INSERT INTO dungeon_lobbies (id, dungeon_id, host_id, required_level, max_players, created_at) VALUES (?, ?, ?, ?, ?, ?);
`;

export const INSERT_MEMBER = `INSERT INTO dungeon_lobby_members (lobby_id, player_id, joined_at) VALUES (?, ?, ?);`;

export const DELETE_MEMBER = `DELETE FROM dungeon_lobby_members WHERE lobby_id = ? AND player_id = ?;`;

export const CLOSE_LOBBY = `UPDATE dungeon_lobbies SET closed_at = ? WHERE id = ?;`;

export const START_LOBBY = `UPDATE dungeon_lobbies SET started_at = ? WHERE id = ?;`;
