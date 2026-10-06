import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: flag.default('false'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(5).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(14).default(11),
  // Render sets RENDER_EXTERNAL_URL to the service's public address, which is
  // the app's origin when the server also serves the client.
  CLIENT_ORIGIN: z.string().default(process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173'),
  // Set to the built client (client/dist) to serve the app from this server,
  // so the UI and the API share one origin without a separate web server.
  CLIENT_DIST_DIR: z.string().optional(),
  COOKIE_SECURE: flag.default('false'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  UPLOAD_DIR: z.string().default('./uploads'),
  SEED_ON_START: flag.default('false'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
  console.error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true (browsers reject the cookie otherwise).');
  process.exit(1);
}

export const config = Object.freeze({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
  jwtAccessSecret: env.JWT_ACCESS_SECRET,
  accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlMs: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  bcryptRounds: env.BCRYPT_ROUNDS,
  clientOrigins: env.CLIENT_ORIGIN.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
  cookieSecure: env.COOKIE_SECURE,
  cookieSameSite: env.COOKIE_SAMESITE,
  trustProxy: env.TRUST_PROXY,
  uploadDir: path.resolve(env.UPLOAD_DIR),
  clientDistDir: env.CLIENT_DIST_DIR ? path.resolve(env.CLIENT_DIST_DIR) : null,
  seedOnStart: env.SEED_ON_START,
});
