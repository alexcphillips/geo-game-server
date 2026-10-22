const ELECTION_COLUMNS = `id, candidate_ids, status, starts_at, ends_at, winner_id, closed_at`;

export const FIND_OPEN_ELECTION = `
  SELECT ${ELECTION_COLUMNS} FROM geo.elections WHERE status = 'open';
`;

/** Locks the open election: closing it, and voting in it, both start here. */
export const LOCK_OPEN_ELECTION = `
  SELECT ${ELECTION_COLUMNS} FROM geo.elections WHERE status = 'open' FOR UPDATE;
`;

/** For a vote: shares the lock, so votes run side by side but never during a close. */
export const SHARE_ELECTION = `
  SELECT ${ELECTION_COLUMNS} FROM geo.elections WHERE id = $1 FOR SHARE;
`;

/** Two servers opening one at once: the unique index lets one win. */
export const INSERT_ELECTION = `
  INSERT INTO geo.elections (candidate_ids, ends_at) VALUES ($1, $2)
  ON CONFLICT DO NOTHING
  RETURNING ${ELECTION_COLUMNS};
`;

export const CLOSE_ELECTION = `
  UPDATE geo.elections SET status = 'closed', winner_id = $2, closed_at = now() WHERE id = $1;
`;

export const SET_ENDS_AT = `UPDATE geo.elections SET ends_at = $2 WHERE id = $1;`;

/**
 * Each candidate's weighted votes and voters, and when their last vote came
 * (for ties: whoever reached the total first wins).
 */
export const TALLY = `
  SELECT candidate_id, SUM(weight) AS votes, COUNT(*) AS voters, MAX(created_at) AS last_vote_at
  FROM geo.election_votes WHERE election_id = $1
  GROUP BY candidate_id;
`;

export const FIND_VOTE = `
  SELECT candidate_id, weight FROM geo.election_votes WHERE election_id = $1 AND player_id = $2;
`;

/** No row back: the player had already voted. */
export const INSERT_VOTE = `
  INSERT INTO geo.election_votes (election_id, player_id, candidate_id, weight) VALUES ($1, $2, $3, $4)
  ON CONFLICT (election_id, player_id) DO NOTHING
  RETURNING candidate_id;
`;
