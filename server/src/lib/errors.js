import { ZodError } from 'zod';
import { ErrorCode } from '../shared.js';

/** An error that is safe to describe to the client. */
export class AppError extends Error {
  /**
   * @param {number} status   HTTP status code.
   * @param {string} code     One of `ErrorCode`.
   * @param {string} message  Shown to the user.
   * @param {{path: string, message: string}[]} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, ErrorCode.VALIDATION, message, details);

export const unauthenticated = (message = 'Authentication required', code = ErrorCode.UNAUTHENTICATED) =>
  new AppError(401, code, message);

export const forbidden = (message = 'You are not allowed to do that') =>
  new AppError(403, ErrorCode.FORBIDDEN, message);

export const notFound = (message = 'Not found') => new AppError(404, ErrorCode.NOT_FOUND, message);

export const conflict = (message) => new AppError(409, ErrorCode.CONFLICT, message);

export const rateLimited = (message = 'Too many requests, slow down') =>
  new AppError(429, ErrorCode.RATE_LIMITED, message);

/**
 * Converts anything thrown into `{ status, body }`, where `body` is the
 * `ErrorPayload` sent to clients. Unknown errors never leak their message.
 */
export function describeError(err) {
  if (err instanceof AppError) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return { status: err.status, body, expected: true };
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    const first = details[0];
    const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid input';
    return { status: 400, body: { code: ErrorCode.VALIDATION, message, details }, expected: true };
  }

  return {
    status: 500,
    body: { code: ErrorCode.INTERNAL, message: 'Something went wrong' },
    expected: false,
  };
}
