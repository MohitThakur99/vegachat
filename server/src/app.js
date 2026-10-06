import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { query } from './db/pool.js';
import { ErrorCode } from './shared.js';
import { asyncHandler } from './lib/asyncHandler.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { attachmentsRouter } from './routes/attachments.js';
import { authRouter } from './routes/auth.js';
import { conversationsRouter } from './routes/conversations.js';
import { usersRouter } from './routes/users.js';

// The same policy client/nginx.conf sets when nginx serves the app. Scripts
// only from this origin and no inline script, so injected markup cannot run.
// Images: own files, attachment blobs, and https avatars.
const contentSecurityPolicy = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc: ["'self'", 'ws:', 'wss:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
};

/** Serves the built React app, for deployments without a separate web server. */
function serveClient(app, distDir) {
  // Hashed file names: safe to cache for good.
  app.use('/assets', express.static(path.join(distDir, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(distDir, { index: false }));

  // Client-side routes (/login, /c/<id>) all get the app shell. Unknown API
  // paths fall through to the JSON 404 instead.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Needed for the real client address (rate limiting) behind nginx or a PaaS.
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({ contentSecurityPolicy }));
  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      await query('SELECT 1');
      res.json({ status: 'ok' });
    }),
  );

  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: ErrorCode.RATE_LIMITED, message: 'Too many requests, slow down' } },
    }),
  );

  app.use('/api/auth', authRouter);

  // Everything below requires a valid access token.
  app.use('/api/users', authenticate, usersRouter);
  app.use('/api/conversations', authenticate, conversationsRouter);
  app.use('/api/attachments', authenticate, attachmentsRouter);

  if (config.clientDistDir) serveClient(app, config.clientDistDir);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
