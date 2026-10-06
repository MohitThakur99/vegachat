import { pool, query } from '../db/pool.js';

/** The signed-in user's own profile. Includes the email. */
export const toSelf = (row) => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  createdAt: row.created_at,
});

export async function getUserById(userId) {
  const { rows } = await query(
    'SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = $1',
    [userId],
  );
  return rows[0] ? toSelf(rows[0]) : null;
}

/**
 * @param {string[]} userIds
 * @returns {Promise<Map<string, string>>} id -> display name, for the ids that exist.
 */
export async function getDisplayNames(userIds, db = pool) {
  const { rows } = await db.query('SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  return new Map(rows.map((row) => [row.id, row.display_name]));
}

/**
 * Finds people to start a chat with: name contains the term, or email starts
 * with it. Never returns the searcher.
 */
export async function searchUsers(userId, term) {
  // The term is user input going into a LIKE pattern: escape its wildcards.
  const escaped = term.replace(/[\\%_]/g, '\\$&');
  const { rows } = await query(
    `SELECT id, email, display_name, avatar_url
     FROM users
     WHERE id <> $1
       AND (display_name ILIKE $2 ESCAPE '\\' OR email::text ILIKE $3 ESCAPE '\\')
     ORDER BY (lower(display_name) LIKE lower($3) ESCAPE '\\') DESC, lower(display_name)
     LIMIT 20`,
    [userId, `%${escaped}%`, `${escaped}%`],
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  }));
}

/** Records when the user's last connection closed. */
export async function touchLastSeen(userId) {
  const { rows } = await query('UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at', [
    userId,
  ]);
  return rows[0]?.last_seen_at ?? null;
}
