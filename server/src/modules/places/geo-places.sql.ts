const PLACE_COLUMNS = `
  pl.id, pl.kind, pl.name, pl.description, pl.latitude, pl.longitude, pl.settings, pl.active,
  pl.suggestion_id, c.display_name AS created_by, pl.created_at, pl.updated_at
`;

/** Active places inside a box; the caller trims the corners by distance. */
export const FIND_ACTIVE_IN_BOX = `
  SELECT id, kind, name, description, latitude, longitude, settings
  FROM geo.places
  WHERE active AND latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4
  LIMIT 1000;
`;

/** Every place, inactive ones too, newest first. */
export const FIND_PLACES = `
  SELECT ${PLACE_COLUMNS}
  FROM geo.places pl
  LEFT JOIN geo.players c ON c.id = pl.created_by
  ORDER BY pl.created_at DESC
  LIMIT 1000;
`;

export const FIND_PLACE = `
  SELECT ${PLACE_COLUMNS}
  FROM geo.places pl
  LEFT JOIN geo.players c ON c.id = pl.created_by
  WHERE pl.id = $1;
`;

export const INSERT_PLACE = `
  INSERT INTO geo.places (kind, name, description, latitude, longitude, settings, created_by, suggestion_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING id;
`;

/** Null leaves a field as it is. */
export const UPDATE_PLACE = `
  UPDATE geo.places SET
    kind = COALESCE($2, kind),
    name = COALESCE($3, name),
    description = COALESCE($4, description),
    latitude = COALESCE($5, latitude),
    longitude = COALESCE($6, longitude),
    active = COALESCE($7, active),
    settings = COALESCE($8, settings),
    updated_at = now()
  WHERE id = $1
  RETURNING id;
`;

/** Returns the row as it was, for the audit log. */
export const DELETE_PLACE = `
  DELETE FROM geo.places WHERE id = $1
  RETURNING id, kind, name, description, latitude, longitude, settings, active, suggestion_id;
`;
