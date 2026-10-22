// From server/src/modules/places/geo-places.sql.ts: the player side. Admin editing comes in session 4.

/** Active places inside a box; the caller trims the corners by distance. Uses `places_active_position`. */
export const FIND_ACTIVE_IN_BOX = `
  SELECT id, kind, name, description, latitude, longitude, settings
  FROM places
  WHERE active AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
  LIMIT 1000;
`;
