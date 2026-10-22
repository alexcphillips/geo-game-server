export const INSERT_FEEDBACK = `
  INSERT INTO feedback (id, player_id, kind, title, body, app_version, platform, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;

/** The player's own, newest first, with how many replies each has had. Uses `feedback_player`, `messages_feedback`. */
export const FIND_MY_FEEDBACK = `
  SELECT f.id, f.kind, f.title, f.status, f.created_at,
         (SELECT count(*) FROM messages m WHERE m.feedback_id = f.id) AS replies
  FROM feedback f
  WHERE f.player_id = ?
  ORDER BY f.created_at DESC
  LIMIT 50;
`;

const ADMIN_COLUMNS = `
  f.id, f.kind, f.title, f.body, f.player_id, p.display_name AS player_name,
  f.app_version, f.platform, f.status, u.display_name AS updated_by, f.updated_at, f.created_at,
  (SELECT json_group_array(json_object('body', r.body, 'from', r.sender, 'createdAt', r.created_at))
   FROM (SELECT m.body, s.display_name AS sender, m.created_at
         FROM messages m LEFT JOIN players s ON s.id = m.sent_by
         WHERE m.feedback_id = f.id ORDER BY m.created_at) r) AS replies
`;

const ADMIN_FROM = `
  FROM feedback f
  LEFT JOIN players p ON p.id = f.player_id
  LEFT JOIN players u ON u.id = f.updated_by
`;

/** Every status, newest first (admin only). */
export const FIND_ALL_FEEDBACK = `SELECT ${ADMIN_COLUMNS} ${ADMIN_FROM} ORDER BY f.created_at DESC LIMIT 200;`;

/** One status, newest first. Uses `feedback_status`. */
export const FIND_FEEDBACK_BY_STATUS = `
  SELECT ${ADMIN_COLUMNS} ${ADMIN_FROM} WHERE f.status = ? ORDER BY f.created_at DESC LIMIT 200;
`;

export const FIND_ONE_FEEDBACK = `SELECT ${ADMIN_COLUMNS} ${ADMIN_FROM} WHERE f.id = ?;`;

export const COUNT_FEEDBACK = `SELECT status, count(*) AS count FROM feedback GROUP BY status;`;

export const SET_STATUS = `
  UPDATE feedback SET status = ?, updated_by = ?, updated_at = ? WHERE id = ? RETURNING id;
`;

/** A reply means an admin has read it: new becomes seen; anything else stays. */
export const MARK_SEEN = `
  UPDATE feedback SET status = 'seen', updated_by = ?, updated_at = ? WHERE id = ? AND status = 'new';
`;

/** Who a reply goes to. */
export const FIND_FEEDBACK_SENDER = `SELECT id, player_id, title FROM feedback WHERE id = ?;`;
