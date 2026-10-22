/** Active places inside a box; the caller trims the corners by distance. Uses `places_active_position`. */
export const FIND_ACTIVE_IN_BOX = `
  SELECT id, kind, name, description, latitude, longitude, settings
  FROM places
  WHERE active AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
  LIMIT 1000;
`;

const PLACE_COLUMNS = `
  pl.id, pl.kind, pl.name, pl.description, pl.latitude, pl.longitude, pl.settings, pl.active,
  pl.suggestion_id, c.display_name AS created_by, pl.created_at, pl.updated_at
`;

/** Every place, inactive ones too, newest first (admin). Uses `places_created`. */
export const FIND_PLACES = `
  SELECT ${PLACE_COLUMNS}
  FROM places pl
  LEFT JOIN players c ON c.id = pl.created_by
  ORDER BY pl.created_at DESC
  LIMIT 1000;
`;

export const FIND_PLACE = `
  SELECT ${PLACE_COLUMNS}
  FROM places pl
  LEFT JOIN players c ON c.id = pl.created_by
  WHERE pl.id = ?;
`;

/** Whether a suggestion already has its place. Uses the unique `suggestion_id`. */
export const FIND_PLACE_FOR_SUGGESTION = `SELECT id FROM places WHERE suggestion_id = ?;`;

export const INSERT_PLACE = `
  INSERT INTO places (id, kind, name, description, latitude, longitude, settings, created_by, suggestion_id, created_at, updated_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10);
`;

/** Place `?1`; null leaves a field as it is. `?9` is now. */
export const UPDATE_PLACE = `
  UPDATE places SET
    kind = coalesce(?2, kind),
    name = coalesce(?3, name),
    description = coalesce(?4, description),
    latitude = coalesce(?5, latitude),
    longitude = coalesce(?6, longitude),
    active = coalesce(?7, active),
    settings = coalesce(?8, settings),
    updated_at = ?9
  WHERE id = ?1
  RETURNING id;
`;

/** Returns the row as it was, for the audit log. */
export const DELETE_PLACE = `
  DELETE FROM places WHERE id = ?
  RETURNING id, kind, name, description, latitude, longitude, settings, active, suggestion_id;
`;
