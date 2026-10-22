/** Banned players can't be found, so they can't be asked either. Uses `players_display_name_key`. */
export const FIND_PLAYER_BY_NAME = `
  SELECT id, display_name AS name FROM players
  WHERE lower(display_name) = lower(?) AND banned_at IS NULL;
`;

/** The pair's row, whichever way it was asked. Uses `friendships_pair`. */
export const FIND_PAIR = `
  SELECT id, requester_id, addressee_id, status FROM friendships
  WHERE min(requester_id, addressee_id) = min(?1, ?2) AND max(requester_id, addressee_id) = max(?1, ?2);
`;

/** Friends and requests either way: what GEO_FRIENDS_MAX caps. */
export const COUNT_RELATIONS = `
  SELECT count(*) AS count FROM friendships WHERE requester_id = ?1 OR addressee_id = ?1;
`;

export const INSERT_REQUEST = `
  INSERT INTO friendships (id, requester_id, addressee_id, created_at) VALUES (?, ?, ?, ?);
`;

/** Only the addressee accepts, and only once. */
export const ACCEPT_REQUEST = `
  UPDATE friendships SET status = 'accepted', accepted_at = ?3
  WHERE id = ?1 AND addressee_id = ?2 AND status = 'pending'
  RETURNING id, requester_id, addressee_id;
`;

/** Declined by the addressee, or cancelled by the requester. */
export const DELETE_REQUEST = `
  DELETE FROM friendships
  WHERE id = ?1 AND status = 'pending' AND (requester_id = ?2 OR addressee_id = ?2)
  RETURNING id, requester_id, addressee_id;
`;

export const DELETE_FRIEND = `
  DELETE FROM friendships
  WHERE status = 'accepted'
    AND min(requester_id, addressee_id) = min(?1, ?2) AND max(requester_id, addressee_id) = max(?1, ?2)
  RETURNING id, requester_id, addressee_id;
`;

/** Every friend (presence is the socket hub's). */
export const FIND_FRIENDS = `
  SELECT p.id, p.display_name AS name, f.accepted_at
  FROM friendships f
  JOIN players p ON p.id = CASE WHEN f.requester_id = ?1 THEN f.addressee_id ELSE f.requester_id END
  WHERE f.status = 'accepted' AND (f.requester_id = ?1 OR f.addressee_id = ?1);
`;

/** Just the ids, for telling friends something changed. */
export const FIND_FRIEND_IDS = `
  SELECT CASE WHEN requester_id = ?1 THEN addressee_id ELSE requester_id END AS id
  FROM friendships
  WHERE status = 'accepted' AND (requester_id = ?1 OR addressee_id = ?1);
`;

/** Pending requests either way, newest first, with the other player's name. */
export const FIND_REQUESTS = `
  SELECT f.id, f.requester_id = ?1 AS outgoing, p.id AS player_id, p.display_name AS name, f.created_at
  FROM friendships f
  JOIN players p ON p.id = CASE WHEN f.requester_id = ?1 THEN f.addressee_id ELSE f.requester_id END
  WHERE f.status = 'pending' AND (f.requester_id = ?1 OR f.addressee_id = ?1)
  ORDER BY f.created_at DESC;
`;

export const COUNT_INCOMING = `
  SELECT count(*) AS count FROM friendships WHERE addressee_id = ? AND status = 'pending';
`;
