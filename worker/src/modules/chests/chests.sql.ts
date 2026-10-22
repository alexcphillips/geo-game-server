const SELECTION_COLUMNS = `id, player_id, source_kind, source_name, run_id, chests, opened_index, opened_at, created_at`;

/** PLACEHOLDER: how many opened selections the history shows. */
export const HISTORY_LIMIT = 50;

export const INSERT_SELECTION = `
  INSERT INTO chest_selections (id, player_id, source_kind, source_name, run_id, chests, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  RETURNING ${SELECTION_COLUMNS};
`;

/** Not opened yet, oldest first. Uses `chest_selections_player`. */
export const FIND_PENDING = `
  SELECT ${SELECTION_COLUMNS} FROM chest_selections
  WHERE player_id = ? AND opened_at IS NULL
  ORDER BY created_at;
`;

/** Opened, newest first. */
export const FIND_HISTORY = `
  SELECT ${SELECTION_COLUMNS} FROM chest_selections
  WHERE player_id = ? AND opened_at IS NOT NULL
  ORDER BY opened_at DESC
  LIMIT ${HISTORY_LIMIT};
`;

export const FIND_SELECTION = `
  SELECT ${SELECTION_COLUMNS} FROM chest_selections WHERE id = ? AND player_id = ?;
`;

export const MARK_OPENED = `
  UPDATE chest_selections SET opened_index = ?, opened_at = ?
  WHERE id = ? AND opened_at IS NULL
  RETURNING ${SELECTION_COLUMNS};
`;
