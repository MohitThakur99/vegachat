import { verifyAccessToken } from '../lib/tokens.js';
import { unauthenticated } from '../lib/errors.js';

/** Requires a valid `Authorization: Bearer <access token>` and sets `req.userId`. */
export function authenticate(req, _res, next) {
  try {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthenticated();
    req.userId = verifyAccessToken(token).userId;
    next();
  } catch (err) {
    next(err);
  }
}
