import { z } from 'zod';
import { Limits } from '../shared.js';

export const uuid = z.string().uuid();

/** A message sequence number as carried in JSON (socket payloads). */
export const seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const messageBody = z.string().trim().max(Limits.MESSAGE_MAX_LENGTH);

export const nonEmptyMessageBody = messageBody.min(1, 'Message cannot be empty');
