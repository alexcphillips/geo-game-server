const SUGGESTION_COLUMNS = `
  s.id, s.kind, s.latitude, s.longitude, s.note, s.player_id, p.display_name AS player_name,
  s.player_latitude, s.player_longitude, s.gps_accuracy, s.distance_metres,
  s.status, s.review_note, r.display_name AS reviewed_by, s.reviewed_at, s.created_at,
  pl.id AS place_id, s.original_latitude, s.original_longitude
`;

export const INSERT_SUGGESTION = `
  INSERT INTO geo.location_suggestions
    (player_id, kind, latitude, longitude, note, player_latitude, player_longitude, gps_accuracy, distance_metres)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING id;
`;

/** Newest first. `$1` is a status, or null for every status. */
export const FIND_SUGGESTIONS = `
  SELECT ${SUGGESTION_COLUMNS}
  FROM geo.location_suggestions s
  LEFT JOIN geo.players p ON p.id = s.player_id
  LEFT JOIN geo.players r ON r.id = s.reviewed_by
  LEFT JOIN geo.places pl ON pl.suggestion_id = s.id
  WHERE $1::text IS NULL OR s.status = $1
  ORDER BY s.created_at DESC
  LIMIT 200;
`;

export const FIND_SUGGESTION = `
  SELECT ${SUGGESTION_COLUMNS}
  FROM geo.location_suggestions s
  LEFT JOIN geo.players p ON p.id = s.player_id
  LEFT JOIN geo.players r ON r.id = s.reviewed_by
  LEFT JOIN geo.places pl ON pl.suggestion_id = s.id
  WHERE s.id = $1;
`;

export const COUNT_SUGGESTIONS = `
  SELECT status, COUNT(*) AS count FROM geo.location_suggestions GROUP BY status;
`;

/** Reopening ("open") clears the review. */
export const REVIEW_SUGGESTION = `
  UPDATE geo.location_suggestions
  SET status = $2::text,
      review_note = CASE WHEN $2::text = 'open' THEN NULL ELSE $3::text END,
      reviewed_by = CASE WHEN $2::text = 'open' THEN NULL ELSE $4::uuid END,
      reviewed_at = CASE WHEN $2::text = 'open' THEN NULL ELSE now() END
  WHERE id = $1
  RETURNING id;
`;

/**
 * Making a place from a suggestion accepts it. One already accepted keeps
 * its reviewer, time and note.
 */
export const ACCEPT_FOR_PLACE = `
  UPDATE geo.location_suggestions
  SET status = 'accepted',
      reviewed_by = CASE WHEN status = 'accepted' THEN reviewed_by ELSE $2::uuid END,
      reviewed_at = CASE WHEN status = 'accepted' THEN reviewed_at ELSE now() END
  WHERE id = $1
  RETURNING id;
`;

/**
 * Null leaves a field as it is. The first move keeps the player's pin in
 * original_*; later moves leave it alone.
 */
export const ADJUST_SUGGESTION = `
  UPDATE geo.location_suggestions SET
    kind = COALESCE($2, kind),
    original_latitude = CASE WHEN $3::float8 IS NOT NULL THEN COALESCE(original_latitude, latitude) ELSE original_latitude END,
    original_longitude = CASE WHEN $3::float8 IS NOT NULL THEN COALESCE(original_longitude, longitude) ELSE original_longitude END,
    latitude = COALESCE($3, latitude),
    longitude = COALESCE($4, longitude)
  WHERE id = $1
  RETURNING id;
`;
