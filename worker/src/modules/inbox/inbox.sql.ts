// Only the writes other modules need (farm contest results); the inbox routes move in session 4.

export const INSERT_MESSAGE = `
  INSERT INTO messages (id, player_id, kind, title, body, sent_by, feedback_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;

export const INSERT_ANNOUNCEMENT = `
  INSERT INTO announcements (id, kind, title, body, version, posted_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;
