// The read side and the progress writes other modules need; the quest routes move in session 4.

/** Every quest the player has held, turned in or not. */
export const FIND_QUESTS = `
  SELECT quest_id, progress, tracked, started_at, claimed_at FROM player_quests WHERE player_id = ?;
`;

export const INSERT_QUEST = `
  INSERT INTO player_quests (player_id, quest_id, tracked, started_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (player_id, quest_id) DO NOTHING;
`;

export const SET_PROGRESS = `UPDATE player_quests SET progress = ? WHERE player_id = ? AND quest_id = ?;`;
