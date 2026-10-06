import path from 'node:path';
import { query } from '../db/pool.js';
import { ALLOWED_UPLOAD_MIME_TYPES, Limits } from '../shared.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { removeFiles, saveFile } from '../lib/storage.js';
import { requireMembership } from './access.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Works out what a file really is from its first bytes. The browser-supplied
 * Content-Type and the file extension are both attacker-controlled, so neither
 * is trusted on its own.
 *
 * @param {Buffer} buffer
 * @returns {string|null} a MIME type, or null when the content is not recognised.
 */
export function sniffMimeType(buffer) {
  const ascii = (start, end) => buffer.toString('latin1', start, end);

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (buffer.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf';
  // No signature for plain text: accept anything without NUL bytes.
  if (!buffer.includes(0)) return 'text/plain';
  return null;
}

function sanitizeFileName(name) {
  const base = path
    .basename(String(name ?? '').replace(/\\/g, '/'))
    // Control characters and characters that are unsafe in a Content-Disposition header.
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .trim();
  return (base || 'file').slice(0, Limits.FILE_NAME_MAX);
}

const toAttachment = (row) => ({
  id: row.id,
  name: row.original_name,
  mimeType: row.mime_type,
  size: row.size_bytes,
});

/**
 * Stores an upload for later use in one message. Membership is checked by the
 * route before the body is read; type and size are checked here.
 *
 * @param {{ buffer: Buffer, originalname: string, mimetype: string, size: number }} file  From multer.
 */
export async function createAttachment(userId, conversationId, file) {
  if (!file || file.size === 0) throw badRequest('Choose a file to upload');

  const actualType = sniffMimeType(file.buffer);
  const declaredType = String(file.mimetype ?? '').toLowerCase();
  if (!actualType || !ALLOWED_UPLOAD_MIME_TYPES.includes(actualType) || actualType !== declaredType) {
    throw badRequest('Only PNG, JPEG, GIF, WebP, PDF and plain-text files can be shared');
  }

  const storageKey = await saveFile(file.buffer);
  try {
    const { rows } = await query(
      `INSERT INTO attachments (conversation_id, uploader_id, original_name, mime_type, size_bytes, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, original_name, mime_type, size_bytes`,
      [conversationId, userId, sanitizeFileName(file.originalname), actualType, file.size, storageKey],
    );
    return toAttachment(rows[0]);
  } catch (err) {
    await removeFiles([storageKey]);
    throw err;
  }
}

/**
 * Looks up an attachment for download. Only current members of its
 * conversation can fetch it, and only once it is part of a message (or by the
 * person who uploaded it).
 */
export async function getAttachmentForDownload(userId, attachmentId) {
  const { rows } = await query(
    `SELECT id, conversation_id, uploader_id, message_id, original_name, mime_type, size_bytes, storage_key
     FROM attachments WHERE id = $1`,
    [attachmentId],
  );
  const attachment = rows[0];
  if (!attachment) throw notFound('File not found');

  try {
    await requireMembership(attachment.conversation_id, userId);
  } catch (err) {
    if (err instanceof AppError) throw notFound('File not found');
    throw err;
  }
  if (!attachment.message_id && attachment.uploader_id !== userId) throw notFound('File not found');

  return {
    ...toAttachment(attachment),
    storageKey: attachment.storage_key,
  };
}
