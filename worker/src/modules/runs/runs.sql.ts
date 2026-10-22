// Only the mid-Run guards for now; Runs themselves move in session 3.

/** The Run in progress, if any. Uses `runs_one_active`. */
export const FIND_ACTIVE_RUN = `SELECT id, kind FROM runs WHERE player_id = ? AND status = 'active';`;
