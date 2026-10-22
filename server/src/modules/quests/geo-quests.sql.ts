const QUEST_COLUMNS = `quest_id, progress, tracked, started_at, claimed_at`;

/** Every quest the player has held, turned in or not. */
export const FIND_QUESTS = `
  SELECT ${QUEST_COLUMNS} FROM geo.player_quests WHERE player_id = $1;
`;

/** Quests held and not yet turned in, locked so two wins can't both count from the same start. */
export const FIND_OPEN_QUESTS_FOR_UPDATE = `
  SELECT ${QUEST_COLUMNS} FROM geo.player_quests
  WHERE player_id = $1 AND claimed_at IS NULL
  FOR UPDATE;
`;

export const FIND_QUEST_FOR_UPDATE = `
  SELECT ${QUEST_COLUMNS} FROM geo.player_quests
  WHERE player_id = $1 AND quest_id = $2
  FOR UPDATE;
`;

/** Gives a quest; one already held (even turned in) stays as it is. */
export const INSERT_QUEST = `
  INSERT INTO geo.player_quests (player_id, quest_id, tracked)
  VALUES ($1, $2, $3)
  ON CONFLICT (player_id, quest_id) DO NOTHING;
`;

export const SET_PROGRESS = `
  UPDATE geo.player_quests SET progress = $3::jsonb WHERE player_id = $1 AND quest_id = $2;
`;

/** Tracks one held quest and untracks the rest. */
export const SET_TRACKED = `
  UPDATE geo.player_quests SET tracked = (quest_id = $2)
  WHERE player_id = $1 AND claimed_at IS NULL;
`;

export const CLAIM_QUEST = `
  UPDATE geo.player_quests SET claimed_at = now(), tracked = false
  WHERE player_id = $1 AND quest_id = $2;
`;

/** Whether the player has ever placed a camp (clearing it keeps camp_set_at), and coins ever banked. */
export const FIND_QUEST_HISTORY = `
  SELECT
    camp_set_at IS NOT NULL AS camp_placed,
    COALESCE((
      SELECT -SUM(delta) FROM geo.coin_ledger WHERE player_id = $1 AND reason = 'bank-deposit'
    ), 0)::bigint AS deposited
  FROM geo.players WHERE id = $1;
`;
