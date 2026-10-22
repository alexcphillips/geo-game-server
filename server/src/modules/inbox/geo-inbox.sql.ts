/**
 * An announcement is read for a player once it's no newer than their
 * inbox_read_at, or than when they joined if they've never opened the inbox:
 * news from before a player existed never counts as unread.
 */
const READ_UP_TO = `COALESCE(p.inbox_read_at, p.created_at)`;
const LIVE = `(a.expires_at IS NULL OR a.expires_at > now())`;

/** Newest first, with the admin's name and the feedback replied to. */
export const FIND_MESSAGES = `
  SELECT m.id, m.kind, m.title, m.body, s.display_name AS sent_by_name,
         f.title AS feedback_title, f.body AS feedback_body,
         m.read_at IS NOT NULL AS read, m.created_at
  FROM geo.messages m
  LEFT JOIN geo.players s ON s.id = m.sent_by
  LEFT JOIN geo.feedback f ON f.id = m.feedback_id
  WHERE m.player_id = $1
  ORDER BY m.created_at DESC
  LIMIT 100;
`;

/** Live announcements, newest first, read or not for player `$1`. */
export const FIND_ANNOUNCEMENTS = `
  SELECT a.id, a.kind, a.title, a.body, a.version, a.expires_at, a.created_at,
         a.created_at <= ${READ_UP_TO} AS read
  FROM geo.announcements a, geo.players p
  WHERE p.id = $1 AND ${LIVE}
  ORDER BY a.created_at DESC
  LIMIT 100;
`;

export const COUNT_UNREAD = `
  SELECT
    (SELECT COUNT(*) FROM geo.messages WHERE player_id = $1 AND read_at IS NULL)
    + (SELECT COUNT(*) FROM geo.announcements a, geo.players p
       WHERE p.id = $1 AND ${LIVE} AND a.created_at > ${READ_UP_TO}) AS count;
`;

/** Up to `$2`; never moves the mark backwards. */
export const MARK_MESSAGES_READ = `
  UPDATE geo.messages SET read_at = now()
  WHERE player_id = $1 AND read_at IS NULL AND created_at <= $2;
`;

export const MARK_ANNOUNCEMENTS_READ = `
  UPDATE geo.players SET inbox_read_at = GREATEST(COALESCE(inbox_read_at, created_at), $2)
  WHERE id = $1;
`;

export const INSERT_MESSAGE = `
  INSERT INTO geo.messages (player_id, kind, title, body, sent_by, feedback_id)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id;
`;

export const INSERT_ANNOUNCEMENT = `
  INSERT INTO geo.announcements (kind, title, body, version, posted_by, expires_at)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id;
`;

/** Every announcement, expired too, for the admin list. */
export const FIND_ALL_ANNOUNCEMENTS = `
  SELECT a.id, a.kind, a.title, a.body, a.version, a.expires_at, a.created_at,
         p.display_name AS posted_by_name
  FROM geo.announcements a
  LEFT JOIN geo.players p ON p.id = a.posted_by
  ORDER BY a.created_at DESC
  LIMIT 200;
`;

export const DELETE_ANNOUNCEMENT = `
  DELETE FROM geo.announcements WHERE id = $1 RETURNING id, kind, title;
`;

export const NOW = `SELECT now() AS now;`;
