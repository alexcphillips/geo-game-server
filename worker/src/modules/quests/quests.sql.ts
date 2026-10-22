/** Every quest the player has held, turned in or not. */
export const FIND_QUESTS = `
  SELECT quest_id, progress, tracked, started_at, claimed_at FROM player_quests WHERE player_id = ?;
`;

export const INSERT_QUEST = `
  INSERT INTO player_quests (player_id, quest_id, tracked, started_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (player_id, quest_id) DO NOTHING;
`;

export const SET_PROGRESS = `UPDATE player_quests SET progress = ? WHERE player_id = ? AND quest_id = ?;`;

/** Tracks quest `?2` of player `?1` and untracks the rest, writing only rows that change. */
export const SET_TRACKED = `
  UPDATE player_quests SET tracked = (quest_id = ?2)
  WHERE player_id = ?1 AND claimed_at IS NULL AND tracked <> (quest_id = ?2);
`;

export const CLAIM_QUEST = `
  UPDATE player_quests SET claimed_at = ?, tracked = 0 WHERE player_id = ? AND quest_id = ?;
`;

/** Whether the player has ever placed a camp (clearing it keeps camp_set_at), and coins ever banked. */
export const FIND_QUEST_HISTORY = `
  SELECT
    camp_set_at IS NOT NULL AS camp_placed,
    coalesce((SELECT -sum(delta) FROM coin_ledger WHERE player_id = ?1 AND reason = 'bank-deposit'), 0) AS deposited
  FROM players WHERE id = ?1;
`;
