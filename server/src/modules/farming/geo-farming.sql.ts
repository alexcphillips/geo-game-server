export const FIND_FARM_FOR_UPDATE = `
  SELECT state FROM geo.farms WHERE player_id = $1 FOR UPDATE;
`;

export const INSERT_FARM = `
  INSERT INTO geo.farms (player_id, state) VALUES ($1, $2)
  ON CONFLICT (player_id) DO NOTHING
  RETURNING state;
`;

export const UPDATE_FARM = `
  UPDATE geo.farms SET state = $2, updated_at = now() WHERE player_id = $1;
`;

// Weekly contests. `$4` is how a new score joins the old: added, or the best kept.
export const ADD_CONTEST_SCORE = `
  INSERT INTO geo.farm_contest_scores (week, contest, player_id, score) VALUES ($1, $2, $3, $4)
  ON CONFLICT (week, contest, player_id) DO UPDATE
    SET score = geo.farm_contest_scores.score + EXCLUDED.score, updated_at = now();
`;

export const BEST_CONTEST_SCORE = `
  INSERT INTO geo.farm_contest_scores (week, contest, player_id, score) VALUES ($1, $2, $3, $4)
  ON CONFLICT (week, contest, player_id) DO UPDATE
    SET score = EXCLUDED.score, updated_at = now()
    WHERE EXCLUDED.score > geo.farm_contest_scores.score;
`;

/** Every entrant of a week's contest, best first; ties go to whoever got there first. */
export const RANK_CONTEST = `
  SELECT s.player_id, s.score, p.display_name
  FROM geo.farm_contest_scores s JOIN geo.players p ON p.id = s.player_id
  WHERE s.week = $1 AND s.contest = $2 AND s.score > 0
  ORDER BY s.score DESC, s.updated_at ASC;
`;

/** The leaders of each of a week's contests, the player's own row, and how many entered. */
export const CONTEST_STANDINGS = `
  WITH ranked AS (
    SELECT s.contest, s.player_id, s.score, p.display_name,
           row_number() OVER (PARTITION BY s.contest ORDER BY s.score DESC, s.updated_at ASC) AS rank,
           count(*) OVER (PARTITION BY s.contest) AS entrants
    FROM geo.farm_contest_scores s JOIN geo.players p ON p.id = s.player_id
    WHERE s.week = $1 AND s.score > 0
  )
  SELECT contest, player_id, score, display_name, rank, entrants FROM ranked
  WHERE rank <= 3 OR player_id = $2
  ORDER BY contest, rank;
`;

/** Weeks before `$1` with scores that haven't been paid out. */
export const UNSETTLED_WEEKS = `
  SELECT DISTINCT s.week FROM geo.farm_contest_scores s
  LEFT JOIN geo.farm_weeks w ON w.week = s.week
  WHERE s.week < $1 AND w.settled_at IS NULL
  ORDER BY s.week;
`;

/** Claims a week's payout; returns a row only for the one server that gets it. */
export const CLAIM_SETTLE = `
  INSERT INTO geo.farm_weeks (week, settled_at) VALUES ($1, now())
  ON CONFLICT (week) DO UPDATE SET settled_at = now() WHERE geo.farm_weeks.settled_at IS NULL
  RETURNING week;
`;

/** Claims a week's Monday announcement, likewise. */
export const CLAIM_ANNOUNCE = `
  INSERT INTO geo.farm_weeks (week, announced_at) VALUES ($1, now())
  ON CONFLICT (week) DO UPDATE SET announced_at = now() WHERE geo.farm_weeks.announced_at IS NULL
  RETURNING week;
`;
