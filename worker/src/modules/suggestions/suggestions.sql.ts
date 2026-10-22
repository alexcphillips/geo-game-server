const SUGGESTION_COLUMNS = `
  s.id, s.kind, s.latitude, s.longitude, s.note, s.player_id, p.display_name AS player_name,
  s.player_latitude, s.player_longitude, s.gps_accuracy, s.distance_metres,
  s.status, s.review_note, r.display_name AS reviewed_by, s.reviewed_at, s.created_at,
  pl.id AS place_id, s.original_latitude, s.original_longitude
`;

const SUGGESTION_FROM = `
  FROM location_suggestions s
  LEFT JOIN players p ON p.id = s.player_id
  LEFT JOIN players r ON r.id = s.reviewed_by
  LEFT JOIN places pl ON pl.suggestion_id = s.id
`;

export const INSERT_SUGGESTION = `
  INSERT INTO location_suggestions
    (id, player_id, kind, latitude, longitude, note, player_latitude, player_longitude, gps_accuracy, distance_metres, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

/** Every status, newest first (admin only). */
export const FIND_ALL_SUGGESTIONS = `SELECT ${SUGGESTION_COLUMNS} ${SUGGESTION_FROM} ORDER BY s.created_at DESC LIMIT 200;`;

/** One status, newest first. Uses `location_suggestions_status`. */
export const FIND_SUGGESTIONS_BY_STATUS = `
  SELECT ${SUGGESTION_COLUMNS} ${SUGGESTION_FROM} WHERE s.status = ? ORDER BY s.created_at DESC LIMIT 200;
`;

export const FIND_SUGGESTION = `SELECT ${SUGGESTION_COLUMNS} ${SUGGESTION_FROM} WHERE s.id = ?;`;

export const COUNT_SUGGESTIONS = `SELECT status, count(*) AS count FROM location_suggestions GROUP BY status;`;

/** Status `?2`, note `?3`, admin `?4`, now `?5`. Reopening ("open") clears the review. */
export const REVIEW_SUGGESTION = `
  UPDATE location_suggestions
  SET status = ?2,
      review_note = CASE WHEN ?2 = 'open' THEN NULL ELSE ?3 END,
      reviewed_by = CASE WHEN ?2 = 'open' THEN NULL ELSE ?4 END,
      reviewed_at = CASE WHEN ?2 = 'open' THEN NULL ELSE ?5 END
  WHERE id = ?1
  RETURNING id;
`;

/**
 * Making a place from a suggestion accepts it (admin `?2`, now `?3`). One
 * already accepted keeps its reviewer, time and note.
 */
export const ACCEPT_FOR_PLACE = `
  UPDATE location_suggestions
  SET status = 'accepted',
      reviewed_by = CASE WHEN status = 'accepted' THEN reviewed_by ELSE ?2 END,
      reviewed_at = CASE WHEN status = 'accepted' THEN reviewed_at ELSE ?3 END
  WHERE id = ?1
  RETURNING id;
`;

/**
 * Kind `?2`, latitude `?3`, longitude `?4`; null leaves a field as it is.
 * The first move keeps the player's pin in original_*; later moves leave it alone.
 */
export const ADJUST_SUGGESTION = `
  UPDATE location_suggestions SET
    kind = coalesce(?2, kind),
    original_latitude = CASE WHEN ?3 IS NOT NULL THEN coalesce(original_latitude, latitude) ELSE original_latitude END,
    original_longitude = CASE WHEN ?3 IS NOT NULL THEN coalesce(original_longitude, longitude) ELSE original_longitude END,
    latitude = coalesce(?3, latitude),
    longitude = coalesce(?4, longitude)
  WHERE id = ?1
  RETURNING id;
`;
