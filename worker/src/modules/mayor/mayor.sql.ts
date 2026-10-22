// Read-only until the election module moves (session 4).

/** The mayor in office: the last finished election's winner. Uses `elections_closed`. */
export const CURRENT_MAYOR = `
  SELECT winner_id FROM elections
  WHERE status = 'closed' AND winner_id IS NOT NULL
  ORDER BY closed_at DESC LIMIT 1;
`;
