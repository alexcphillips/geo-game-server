const ELECTION_COLUMNS = `id, candidate_ids, status, starts_at, ends_at, winner_id, closed_at`;

/** The mayor in office: the last finished election's winner. Uses `elections_closed`. */
export const CURRENT_MAYOR = `
  SELECT winner_id FROM elections
  WHERE status = 'closed' AND winner_id IS NOT NULL
  ORDER BY closed_at DESC LIMIT 1;
`;

/** Uses `elections_one_open`. */
export const FIND_OPEN_ELECTION = `SELECT ${ELECTION_COLUMNS} FROM elections WHERE status = 'open';`;

export const FIND_ELECTION = `SELECT ${ELECTION_COLUMNS} FROM elections WHERE id = ?;`;

export const INSERT_ELECTION = `
  INSERT INTO elections (id, candidate_ids, starts_at, ends_at) VALUES (?, ?, ?, ?);
`;

export const CLOSE_ELECTION = `
  UPDATE elections SET status = 'closed', winner_id = ?, closed_at = ? WHERE id = ?;
`;

export const SET_ENDS_AT = `UPDATE elections SET ends_at = ? WHERE id = ?;`;

/**
 * Each candidate's weighted votes and voters, and when their last vote came
 * (for ties: whoever reached the total first wins). The primary key's prefix.
 */
export const TALLY = `
  SELECT candidate_id, sum(weight) AS votes, count(*) AS voters, max(created_at) AS last_vote_at
  FROM election_votes WHERE election_id = ?
  GROUP BY candidate_id;
`;

export const FIND_VOTE = `
  SELECT candidate_id, weight FROM election_votes WHERE election_id = ? AND player_id = ?;
`;

/** No row back: the player had already voted. */
export const INSERT_VOTE = `
  INSERT INTO election_votes (election_id, player_id, candidate_id, weight, created_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (election_id, player_id) DO NOTHING
  RETURNING candidate_id;
`;
