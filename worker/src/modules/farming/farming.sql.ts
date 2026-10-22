export const FIND_FARM = `SELECT state FROM farms WHERE player_id = ?;`;

export const INSERT_FARM = `INSERT INTO farms (player_id, state, updated_at) VALUES (?, ?, ?);`;

export const UPDATE_FARM = `UPDATE farms SET state = ?, updated_at = ? WHERE player_id = ?;`;

// Weekly contests: a harvest adds to the week's score, or keeps the best.
export const ADD_CONTEST_SCORE = `
  INSERT INTO farm_contest_scores (week, contest, player_id, score, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
  ON CONFLICT (week, contest, player_id) DO UPDATE SET score = score + excluded.score, updated_at = excluded.updated_at;
`;

export const BEST_CONTEST_SCORE = `
  INSERT INTO farm_contest_scores (week, contest, player_id, score, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
  ON CONFLICT (week, contest, player_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at
  WHERE excluded.score > score;
`;

/** Every entrant of a week's contest, best first; ties go to whoever got there first. Uses `farm_contest_scores_rank`. */
export const RANK_CONTEST = `
  SELECT s.player_id, s.score, p.display_name
  FROM farm_contest_scores s JOIN players p ON p.id = s.player_id
  WHERE s.week = ? AND s.contest = ? AND s.score > 0
  ORDER BY s.score DESC, s.updated_at ASC;
`;

/** The leaders of each of a week's contests, the player's own row, and how many entered. Reads the week's every score. */
export const CONTEST_STANDINGS = `
  WITH ranked AS (
    SELECT s.contest, s.player_id, s.score, p.display_name,
           row_number() OVER (PARTITION BY s.contest ORDER BY s.score DESC, s.updated_at ASC) AS rank,
           count(*) OVER (PARTITION BY s.contest) AS entrants
    FROM farm_contest_scores s JOIN players p ON p.id = s.player_id
    WHERE s.week = ?1 AND s.score > 0
  )
  SELECT contest, player_id, score, display_name, rank, entrants FROM ranked
  WHERE rank <= 3 OR player_id = ?2
  ORDER BY contest, rank;
`;

/** Weeks from the last one paid ($1 and on, if none) up to before $2 with scores not yet paid out. */
export const UNSETTLED_WEEKS = `
  SELECT DISTINCT s.week FROM farm_contest_scores s
  LEFT JOIN farm_weeks w ON w.week = s.week
  WHERE s.week >= coalesce((SELECT max(week) FROM farm_weeks WHERE settled_at IS NOT NULL), ?1) AND s.week < ?2
    AND w.settled_at IS NULL
  ORDER BY s.week;
`;

/** Marks a week paid; a row back only the first time. */
export const CLAIM_SETTLE = `
  INSERT INTO farm_weeks (week, settled_at) VALUES (?1, ?2)
  ON CONFLICT (week) DO UPDATE SET settled_at = excluded.settled_at WHERE settled_at IS NULL
  RETURNING week;
`;

/** Marks a week's Monday announcement posted, likewise. */
export const CLAIM_ANNOUNCE = `
  INSERT INTO farm_weeks (week, announced_at) VALUES (?1, ?2)
  ON CONFLICT (week) DO UPDATE SET announced_at = excluded.announced_at WHERE announced_at IS NULL
  RETURNING week;
`;
