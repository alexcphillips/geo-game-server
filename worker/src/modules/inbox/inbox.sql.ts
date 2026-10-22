/**
 * An announcement is read for a player once it's no newer than their
 * inbox_read_at, or than when they joined if they've never opened the inbox:
 * news from before a player existed never counts as unread.
 */
const READ_UP_TO = `coalesce(p.inbox_read_at, p.created_at)`;

/** Newest first, with the admin's name and the feedback replied to. Uses `messages_player`. */
export const FIND_MESSAGES = `
  SELECT m.id, m.kind, m.title, m.body, s.display_name AS sent_by_name,
         f.title AS feedback_title, f.body AS feedback_body,
         m.read_at IS NOT NULL AS read, m.created_at
  FROM messages m
  LEFT JOIN players s ON s.id = m.sent_by
  LEFT JOIN feedback f ON f.id = m.feedback_id
  WHERE m.player_id = ?
  ORDER BY m.created_at DESC
  LIMIT 100;
`;

/** Live announcements (`?2` now), newest first, read or not for player `?1`. */
export const FIND_ANNOUNCEMENTS = `
  SELECT a.id, a.kind, a.title, a.body, a.version, a.expires_at, a.created_at,
         a.created_at <= ${READ_UP_TO} AS read
  FROM players p, announcements a
  WHERE p.id = ?1 AND (a.expires_at IS NULL OR a.expires_at > ?2)
  ORDER BY a.created_at DESC
  LIMIT 100;
`;

/** Unread mail for player `?1`: messages, and live announcements (`?2` now) since they last read. */
export const COUNT_UNREAD = `
  SELECT
    (SELECT count(*) FROM messages WHERE player_id = ?1 AND read_at IS NULL)
    + (SELECT count(*) FROM players p, announcements a
       WHERE p.id = ?1 AND a.created_at > ${READ_UP_TO} AND (a.expires_at IS NULL OR a.expires_at > ?2)) AS count;
`;

/** Up to `?3`, read at `?2`; never moves the mark backwards. */
export const MARK_MESSAGES_READ = `
  UPDATE messages SET read_at = ?2
  WHERE player_id = ?1 AND read_at IS NULL AND created_at <= ?3;
`;

/** Only when it moves forward: setting it to what it is would still be a write. */
export const MARK_ANNOUNCEMENTS_READ = `
  UPDATE players SET inbox_read_at = ?2
  WHERE id = ?1 AND coalesce(inbox_read_at, created_at) < ?2;
`;

export const INSERT_MESSAGE = `
  INSERT INTO messages (id, player_id, kind, title, body, sent_by, feedback_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;

export const INSERT_ANNOUNCEMENT = `
  INSERT INTO announcements (id, kind, title, body, version, posted_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;

/** Every announcement, expired too, for the admin list. */
export const FIND_ALL_ANNOUNCEMENTS = `
  SELECT a.id, a.kind, a.title, a.body, a.version, a.expires_at, a.created_at,
         p.display_name AS posted_by_name
  FROM announcements a
  LEFT JOIN players p ON p.id = a.posted_by
  ORDER BY a.created_at DESC
  LIMIT 200;
`;

export const DELETE_ANNOUNCEMENT = `DELETE FROM announcements WHERE id = ? RETURNING id, kind, title;`;

