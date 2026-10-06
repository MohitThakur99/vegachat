import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { ErrorCode } from '../shared.js';
import { unauthenticated } from './errors.js';

const ISSUER = 'vegachat';
const ALGORITHM = 'HS256';

/** Short-lived JWT sent as `Authorization: Bearer` and in the socket handshake. */
export function signAccessToken(userId) {
  return jwt.sign({ typ: 'access' }, config.jwtAccessSecret, {
    algorithm: ALGORITHM,
    subject: userId,
    issuer: ISSUER,
    expiresIn: config.accessTokenTtlSeconds,
  });
}

/**
 * @param {unknown} token
 * @returns {{ userId: string, expiresAt: number }} `expiresAt` in ms since epoch.
 * @throws {AppError} TOKEN_EXPIRED or UNAUTHENTICATED.
 */
export function verifyAccessToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw unauthenticated();
  }
  try {
    // Pinning the algorithm rules out "alg: none" and key-confusion tokens.
    const claims = jwt.verify(token, config.jwtAccessSecret, { algorithms: [ALGORITHM], issuer: ISSUER });
    if (claims.typ !== 'access' || typeof claims.sub !== 'string') {
      throw unauthenticated('Invalid access token');
    }
    return { userId: claims.sub, expiresAt: claims.exp * 1000 };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthenticated('Access token expired', ErrorCode.TOKEN_EXPIRED);
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw unauthenticated('Invalid access token');
    }
    throw err;
  }
}

/** Refresh tokens are opaque random strings; only their hash is stored. */
export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
