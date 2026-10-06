import { Router } from 'express';
import { IMAGE_MIME_TYPES } from '../shared.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { notFound } from '../lib/errors.js';
import { openFile } from '../lib/storage.js';
import { validate } from '../middleware/validate.js';
import { attachmentParams } from '../validation/restSchemas.js';
import { getAttachmentForDownload } from '../services/attachmentService.js';

export const attachmentsRouter = Router();

attachmentsRouter.get(
  '/:attachmentId',
  validate({ params: attachmentParams }),
  asyncHandler(async (req, res, next) => {
    const attachment = await getAttachmentForDownload(req.userId, req.valid.params.attachmentId);

    // Images may render in place; everything else is always a download, so an
    // uploaded file can never run as a page on this origin.
    const disposition = IMAGE_MIME_TYPES.includes(attachment.mimeType) ? 'inline' : 'attachment';
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Length': String(attachment.size),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      'Cache-Control': 'private, max-age=3600',
    });

    const stream = openFile(attachment.storageKey);
    stream.on('error', (err) => {
      if (res.headersSent) return res.destroy(err);
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Disposition');
      next(err.code === 'ENOENT' ? notFound('File not found') : err);
    });
    stream.pipe(res);
  }),
);
