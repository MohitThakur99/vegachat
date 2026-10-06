import multer from 'multer';
import { ErrorCode, Limits } from '../shared.js';
import { describeError } from '../lib/errors.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: ErrorCode.NOT_FOUND, message: 'Route not found' } });
}

// Express recognises error middleware by its four arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    const megabytes = Limits.UPLOAD_MAX_BYTES / (1024 * 1024);
    return res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? ErrorCode.PAYLOAD_TOO_LARGE : ErrorCode.VALIDATION,
        message: tooLarge ? `File is larger than ${megabytes} MB` : 'Invalid upload',
      },
    });
  }

  // Malformed or oversized JSON from express.json().
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(err.status ?? 400).json({
      error: { code: ErrorCode.VALIDATION, message: 'Invalid request body' },
    });
  }

  const { status, body, expected } = describeError(err);
  if (!expected) console.error(`${req.method} ${req.originalUrl} failed`, err);
  res.status(status).json({ error: body });
}
