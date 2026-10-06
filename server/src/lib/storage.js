import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

// Storage keys are random UUIDs generated here. Nothing a user typed is ever
// part of a path, so there is nothing to traverse.
const pathFor = (storageKey) => path.join(config.uploadDir, storageKey);

export async function ensureUploadDir() {
  await fsp.mkdir(config.uploadDir, { recursive: true });
}

/** @returns {Promise<string>} the storage key. */
export async function saveFile(buffer) {
  const storageKey = crypto.randomUUID();
  await fsp.writeFile(pathFor(storageKey), buffer, { flag: 'wx' });
  return storageKey;
}

export function openFile(storageKey) {
  return fs.createReadStream(pathFor(storageKey));
}

/** Best effort: a file that is already gone is not an error. */
export async function removeFiles(storageKeys) {
  await Promise.all(storageKeys.map((key) => fsp.unlink(pathFor(key)).catch(() => {})));
}
