/** A lobby with its host's name and head count. */
const LOBBY_SELECT = `
  SELECT l.id, l.dungeon_id, l.host_id, host.display_name AS host_name, l.required_level, l.max_players,
         l.started_at, l.closed_at,
         (SELECT count(*)::int FROM geo.dungeon_lobby_members m WHERE m.lobby_id = l.id) AS player_count
  FROM geo.dungeon_lobbies l
  JOIN geo.players host ON host.id = l.host_id
`;

/** Lobbies waiting for their host to start them, newest first. $1: at most this many. */
export const LIST_OPEN_LOBBIES = `
  ${LOBBY_SELECT}
  WHERE l.closed_at IS NULL AND l.started_at IS NULL
  ORDER BY l.created_at DESC
  LIMIT $1;
`;

/**
 * Closes unstarted lobbies whose host has been away $1 seconds: offline (no
 * geo socket) and not seen since then, counting making the lobby as being
 * seen. Run before lobbies are read, so a host who walked off doesn't strand them.
 */
export const CLOSE_ABANDONED_LOBBIES = `
  UPDATE geo.dungeon_lobbies l SET closed_at = now()
  FROM geo.players host
  WHERE host.id = l.host_id AND l.closed_at IS NULL AND l.started_at IS NULL
    AND host.activity IS NULL
    AND GREATEST(host.last_seen_at, l.created_at) < now() - make_interval(secs => $1)
  RETURNING l.id;
`;

/** The open lobby the player is in, if any. */
export const FIND_PLAYER_LOBBY = `
  ${LOBBY_SELECT}
  JOIN geo.dungeon_lobby_members me ON me.lobby_id = l.id AND me.player_id = $1
  WHERE l.closed_at IS NULL AND l.started_at IS NULL
  ORDER BY me.joined_at DESC
  LIMIT 1;
`;

/** Locks the lobby row, so a join can't overfill it and a start can't race a join or leave. */
export const LOCK_LOBBY = `SELECT id FROM geo.dungeon_lobbies WHERE id = $1 FOR UPDATE;`;

export const FIND_LOBBY = `
  ${LOBBY_SELECT}
  WHERE l.id = $1;
`;

export const FIND_MEMBERS = `
  SELECT m.player_id, p.display_name
  FROM geo.dungeon_lobby_members m
  JOIN geo.players p ON p.id = m.player_id
  WHERE m.lobby_id = $1
  ORDER BY m.joined_at;
`;

export const INSERT_LOBBY = `
  INSERT INTO geo.dungeon_lobbies (dungeon_id, host_id, required_level, max_players)
  VALUES ($1, $2, $3, $4)
  RETURNING id;
`;

export const INSERT_MEMBER = `
  INSERT INTO geo.dungeon_lobby_members (lobby_id, player_id) VALUES ($1, $2);
`;

export const DELETE_MEMBER = `
  DELETE FROM geo.dungeon_lobby_members WHERE lobby_id = $1 AND player_id = $2;
`;

export const CLOSE_LOBBY = `
  UPDATE geo.dungeon_lobbies SET closed_at = now() WHERE id = $1;
`;

export const START_LOBBY = `
  UPDATE geo.dungeon_lobbies SET started_at = now() WHERE id = $1;
`;
