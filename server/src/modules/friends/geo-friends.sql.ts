/** Banned players can't be found, so they can't be asked either. */
export const FIND_PLAYER_BY_NAME = `
  SELECT id, display_name AS name FROM geo.players
  WHERE lower(display_name) = lower($1) AND banned_at IS NULL;
`;

/** The pair's row, whichever way it was asked. */
export const FIND_PAIR_FOR_UPDATE = `
  SELECT id, requester_id, addressee_id, status FROM geo.friendships
  WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
  FOR UPDATE;
`;

/** Friends and requests either way: what GEO_FRIENDS_MAX caps. */
export const COUNT_RELATIONS = `
  SELECT COUNT(*) AS count FROM geo.friendships WHERE requester_id = $1 OR addressee_id = $1;
`;

/** Nothing if a concurrent request made the pair first. */
export const INSERT_REQUEST = `
  INSERT INTO geo.friendships (requester_id, addressee_id) VALUES ($1, $2)
  ON CONFLICT DO NOTHING
  RETURNING id;
`;

/** Only the addressee accepts, and only once. */
export const ACCEPT_REQUEST = `
  UPDATE geo.friendships SET status = 'accepted', accepted_at = now()
  WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
  RETURNING id, requester_id, addressee_id;
`;

/** Declined by the addressee, or cancelled by the requester. */
export const DELETE_REQUEST = `
  DELETE FROM geo.friendships
  WHERE id = $1 AND status = 'pending' AND (requester_id = $2 OR addressee_id = $2)
  RETURNING id, requester_id, addressee_id;
`;

export const DELETE_FRIEND = `
  DELETE FROM geo.friendships
  WHERE status = 'accepted'
    AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
  RETURNING id, requester_id, addressee_id;
`;

/**
 * Every friend with their presence: online while they have a geo socket
 * (`activity` is set then, and cleared when it closes).
 */
export const FIND_FRIENDS = `
  SELECT p.id, p.display_name AS name, f.accepted_at,
         p.last_seen_at, p.activity, p.activity_skill
  FROM geo.friendships f
  JOIN geo.players p ON p.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
  WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1);
`;

/** Just the ids, for telling friends something changed. */
export const FIND_FRIEND_IDS = `
  SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id
  FROM geo.friendships
  WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1);
`;

/** Pending requests either way, newest first, with the other player's name. */
export const FIND_REQUESTS = `
  SELECT f.id, f.requester_id = $1 AS outgoing, p.id AS player_id, p.display_name AS name, f.created_at
  FROM geo.friendships f
  JOIN geo.players p ON p.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
  WHERE f.status = 'pending' AND (f.requester_id = $1 OR f.addressee_id = $1)
  ORDER BY f.created_at DESC;
`;

/** The app says what the player is doing now. */
export const SET_ACTIVITY = `
  UPDATE geo.players SET activity = $2, activity_skill = $3 WHERE id = $1;
`;

export const COUNT_INCOMING = `
  SELECT COUNT(*) AS count FROM geo.friendships WHERE addressee_id = $1 AND status = 'pending';
`;

/** Their first socket opened: online, exploring until the app says otherwise. */
export const SET_ONLINE = `
  UPDATE geo.players SET last_seen_at = now(), activity = COALESCE(activity, 'exploring') WHERE id = $1;
`;

/** Their last socket closed: offline, last seen now. */
export const SET_OFFLINE = `
  UPDATE geo.players SET last_seen_at = now(), activity = NULL, activity_skill = NULL WHERE id = $1;
`;

/** At boot no one has a socket yet; anyone left online by a crash isn't. */
export const RESET_PRESENCE = `
  UPDATE geo.players SET activity = NULL, activity_skill = NULL WHERE activity IS NOT NULL;
`;
