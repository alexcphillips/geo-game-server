const SELECTION_COLUMNS = `id, player_id, source_kind, source_name, run_id, chests, opened_index, opened_at, created_at`;

/** PLACEHOLDER: how many opened selections the history shows. */
export const HISTORY_LIMIT = 50;

export const INSERT_SELECTION = `
  INSERT INTO geo.chest_selections (player_id, source_kind, source_name, run_id, chests)
  VALUES ($1, $2, $3, $4, $5::jsonb)
  RETURNING ${SELECTION_COLUMNS};
`;

export const FIND_PENDING = `
  SELECT ${SELECTION_COLUMNS} FROM geo.chest_selections
  WHERE player_id = $1 AND opened_at IS NULL
  ORDER BY created_at;
`;

export const COUNT_PENDING = `
  SELECT COUNT(*) AS count FROM geo.chest_selections
  WHERE player_id = $1 AND opened_at IS NULL;
`;

export const FIND_HISTORY = `
  SELECT ${SELECTION_COLUMNS} FROM geo.chest_selections
  WHERE player_id = $1 AND opened_at IS NOT NULL
  ORDER BY opened_at DESC
  LIMIT ${HISTORY_LIMIT};
`;

/** Locks the selection, so two taps can't open two chests of it. */
export const FIND_SELECTION_FOR_UPDATE = `
  SELECT ${SELECTION_COLUMNS} FROM geo.chest_selections
  WHERE id = $1 AND player_id = $2
  FOR UPDATE;
`;

export const MARK_OPENED = `
  UPDATE geo.chest_selections SET opened_index = $2, opened_at = now()
  WHERE id = $1 AND opened_at IS NULL
  RETURNING ${SELECTION_COLUMNS};
`;
