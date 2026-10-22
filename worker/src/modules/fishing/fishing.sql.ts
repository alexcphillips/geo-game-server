/** The admin testing switch (every bite a sea creature), honoured only while the player is still an admin. */
export const ALWAYS_SEA_CREATURES = `
  SELECT always_sea_creatures = 1 AND role = 'admin' AS always FROM players WHERE id = ?;
`;
