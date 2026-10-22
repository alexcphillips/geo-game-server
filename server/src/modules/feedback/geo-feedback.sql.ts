export const INSERT_FEEDBACK = `
  INSERT INTO geo.feedback (player_id, kind, title, body, app_version, platform)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id;
`;

/** The player's own, newest first, with how many replies each has had. */
export const FIND_MY_FEEDBACK = `
  SELECT f.id, f.kind, f.title, f.status, f.created_at,
         (SELECT COUNT(*) FROM geo.messages m WHERE m.feedback_id = f.id) AS replies
  FROM geo.feedback f
  WHERE f.player_id = $1
  ORDER BY f.created_at DESC
  LIMIT 50;
`;

const ADMIN_COLUMNS = `
  f.id, f.kind, f.title, f.body, f.player_id, p.display_name AS player_name,
  f.app_version, f.platform, f.status, u.display_name AS updated_by, f.updated_at, f.created_at,
  COALESCE(
    (SELECT json_agg(json_build_object('body', m.body, 'from', s.display_name, 'createdAt', m.created_at)
                     ORDER BY m.created_at)
     FROM geo.messages m LEFT JOIN geo.players s ON s.id = m.sent_by
     WHERE m.feedback_id = f.id),
    '[]'
  ) AS replies
`;

/** Newest first. `$1` is a status, or null for every status. */
export const FIND_FEEDBACK = `
  SELECT ${ADMIN_COLUMNS}
  FROM geo.feedback f
  LEFT JOIN geo.players p ON p.id = f.player_id
  LEFT JOIN geo.players u ON u.id = f.updated_by
  WHERE $1::text IS NULL OR f.status = $1
  ORDER BY f.created_at DESC
  LIMIT 200;
`;

export const FIND_ONE_FEEDBACK = `
  SELECT ${ADMIN_COLUMNS}
  FROM geo.feedback f
  LEFT JOIN geo.players p ON p.id = f.player_id
  LEFT JOIN geo.players u ON u.id = f.updated_by
  WHERE f.id = $1;
`;

export const COUNT_FEEDBACK = `
  SELECT status, COUNT(*) AS count FROM geo.feedback GROUP BY status;
`;

export const SET_STATUS = `
  UPDATE geo.feedback SET status = $2, updated_by = $3, updated_at = now()
  WHERE id = $1
  RETURNING id;
`;

/** A reply means an admin has read it: new becomes seen; anything else stays. */
export const MARK_SEEN = `
  UPDATE geo.feedback SET status = 'seen', updated_by = $2, updated_at = now()
  WHERE id = $1 AND status = 'new';
`;

/** Locks it while a reply is sent, and says who to send it to. */
export const LOCK_FEEDBACK = `
  SELECT id, player_id, title FROM geo.feedback WHERE id = $1 FOR UPDATE;
`;
