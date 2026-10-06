import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { ErrorCode } from '../shared.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { forbidden, notFound } from '../lib/errors.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { loginBody, signupBody } from '../validation/restSchemas.js';
import * as authService from '../services/authService.js';
import { getUserById } from '../services/userService.js';

const REFRESH_COOKIE = 'vc_refresh';

// The cookie is only ever sent to the auth endpoints, not with every API call.
const cookieOptions = () => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: config.cookieSameSite,
  path: '/api/auth',
});

function setRefreshCookie(res, session) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...cookieOptions(),
    expires: session.refreshTokenExpiresAt,
  });
}

/** The refresh token itself never appears in a response body. */
const sessionBody = (user, session) => ({
  user,
  accessToken: session.accessToken,
  expiresIn: session.expiresIn,
});

// Slows down password guessing and bulk signups from one address.
const credentialLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 50,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: ErrorCode.RATE_LIMITED, message: 'Too many attempts, try again in a few minutes' } },
});

/**
 * The refresh and logout endpoints are authenticated by a cookie, which the
 * browser attaches on its own. Refuse them when the request comes from a page
 * on an origin we do not serve.
 */
function requireTrustedOrigin(req, _res, next) {
  const origin = req.get('origin');
  if (origin && !config.clientOrigins.includes(origin)) {
    return next(forbidden('Requests from this origin are not allowed'));
  }
  next();
}

export const authRouter = Router();

authRouter.post(
  '/signup',
  credentialLimiter,
  validate({ body: signupBody }),
  asyncHandler(async (req, res) => {
    const { user, session } = await authService.signup(req.valid.body);
    setRefreshCookie(res, session);
    res.status(201).json(sessionBody(user, session));
  }),
);

authRouter.post(
  '/login',
  credentialLimiter,
  validate({ body: loginBody }),
  asyncHandler(async (req, res) => {
    const { user, session } = await authService.login(req.valid.body);
    setRefreshCookie(res, session);
    res.json(sessionBody(user, session));
  }),
);

authRouter.post(
  '/refresh',
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    try {
      const { user, session } = await authService.refresh(req.cookies?.[REFRESH_COOKIE]);
      setRefreshCookie(res, session);
      res.json(sessionBody(user, session));
    } catch (err) {
      // A dead cookie would otherwise be retried on every page load.
      if (err.status === 401) res.clearCookie(REFRESH_COOKIE, cookieOptions());
      throw err;
    }
  }),
);

authRouter.post(
  '/logout',
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    await authService.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user) throw notFound('Account not found');
    res.json({ user });
  }),
);
