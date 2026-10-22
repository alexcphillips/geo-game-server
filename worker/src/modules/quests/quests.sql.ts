// Read-only until the quests module moves (session 4): spawns ask which tier is open and what to pull toward.

/** Every quest the player has held, turned in or not. */
export const FIND_QUESTS = `
  SELECT quest_id, progress, tracked, started_at, claimed_at FROM player_quests WHERE player_id = ?;
`;
