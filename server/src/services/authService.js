import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { conflict, unauthenticated } from '../lib/errors.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../lib/tokens.js';
import { getUserById, toSelf } from './userService.js';

/**
 * Two tabs share one refresh cookie and can try to rotate it at the same
 * moment; the loser presents a token that was rotated a few milliseconds ago.
 * Inside this window that is treated as a race, not as theft. It never
 * applies to a token that was revoked (logout).
 */
const ROTATION_GRACE_MS = 20_000;

const UNIQUE_VIOLATION = '23505';

// Compared against when the email is unknown, so "no such user" costs the
// same time as "wrong password".
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

/**
 * @typedef {object} Session
 * @property {string} accessToken
 * @property {number} expiresIn             Access token lifetime in seconds.
 * @property {string} refreshToken          Goes into the httpOnly cookie only.
 * @property {Date} refreshTokenExpiresAt
 */

/** @returns {Promise<Session>} */
async function createSession(userId, familyId = crypto.randomUUID(), db = { query }) {
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = new Date(Date.now() + config.refreshTokenTtlMs);
  await db.query(
    'INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, familyId, hashRefreshToken(refreshToken), refreshTokenExpiresAt],
  );
  return {
    accessToken: signAccessToken(userId),
    expiresIn: config.accessTokenTtlSeconds,
    refreshToken,
    refreshTokenExpiresAt,
  };
}

export async function signup({ email, displayName, password }) {
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  let user;
  try {
    const { rows } = await query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name, avatar_url, created_at`,
      [email, displayName, passwordHash],
    );
    user = toSelf(rows[0]);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) throw conflict('An account with this email already exists');
    throw err;
  }
  return { user, session: await createSession(user.id) };
}

export async function login({ email, password }) {
  const { rows } = await query(
    'SELECT id, email, display_name, avatar_url, created_at, password_hash FROM users WHERE email = $1',
    [email],
  );
  const row = rows[0];
  const matches = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !matches) throw unauthenticated('Incorrect email or password');
  return { user: toSelf(row), session: await createSession(row.id) };
}

/**
 * Exchanges a refresh token for a new access token and a new refresh token.
 * The old refresh token is revoked (rotation). Presenting a token that was
 * revoked earlier means it was copied, so the whole family is revoked and
 * every device from that login has to sign in again.
 */
export async function refresh(refreshToken) {
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    throw unauthenticated('No active session');
  }

  // The outcome is returned rather than thrown: throwing inside the
  // transaction would roll back the family revocation.
  const outcome = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at
       FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashRefreshToken(refreshToken)],
    );
    const token = rows[0];
    if (!token) return { error: 'Invalid session' };
    // Logged out, or killed by an earlier theft detection. No grace applies.
    if (token.revoked_at) return { error: 'Session ended, please sign in again' };
    if (token.expires_at.getTime() <= Date.now()) return { error: 'Session expired, please sign in again' };

    if (token.rotated_at) {
      // Already exchanged once. Recently: another tab won the race. Long ago:
      // someone is replaying a copied token, so end the whole session.
      if (Date.now() - token.rotated_at.getTime() > ROTATION_GRACE_MS) {
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
          [token.family_id],
        );
        return { error: 'Session was revoked, please sign in again' };
      }
    } else {
      await client.query('UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1', [token.id]);
    }

    return {
      userId: token.user_id,
      session: await createSession(token.user_id, token.family_id, client),
    };
  });

  if (outcome.error) throw unauthenticated(outcome.error);

  const user = await getUserById(outcome.userId);
  if (!user) throw unauthenticated('Account no longer exists');
  return { user, session: outcome.session };
}

/** Ends the session on every tab that shares this login. Unknown tokens are ignored. */
export async function logout(refreshToken) {
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) return;
  await query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE revoked_at IS NULL
       AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
    [hashRefreshToken(refreshToken)],
  );
}
