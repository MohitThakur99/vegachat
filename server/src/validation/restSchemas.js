import { z } from 'zod';
import { Limits, Role } from '../shared.js';
import { uuid } from './common.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

const displayName = z
  .string()
  .trim()
  .min(Limits.DISPLAY_NAME_MIN, `Name must be at least ${Limits.DISPLAY_NAME_MIN} characters`)
  .max(Limits.DISPLAY_NAME_MAX, `Name must be at most ${Limits.DISPLAY_NAME_MAX} characters`);

const groupName = z
  .string()
  .trim()
  .min(1, 'Group name is required')
  .max(Limits.GROUP_NAME_MAX, `Group name must be at most ${Limits.GROUP_NAME_MAX} characters`);

const avatarUrl = z
  .string()
  .trim()
  .url('Avatar must be a valid URL')
  .max(Limits.AVATAR_URL_MAX)
  // Blocks javascript:, data: and friends from ever reaching an <img src>.
  .refine((value) => /^https?:\/\//i.test(value), 'Avatar must be an http(s) URL');

const userIdList = z
  .array(uuid)
  .max(Limits.GROUP_MAX_MEMBERS)
  .transform((ids) => [...new Set(ids)]);

const cursor = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const signupBody = z
  .object({
    email,
    displayName,
    password: z
      .string()
      .min(Limits.PASSWORD_MIN, `Password must be at least ${Limits.PASSWORD_MIN} characters`)
      .max(Limits.PASSWORD_MAX, `Password must be at most ${Limits.PASSWORD_MAX} characters`),
  })
  .strict();

export const loginBody = z.object({ email, password: z.string().min(1).max(200) }).strict();

export const userSearchQuery = z.object({
  q: z.string().trim().min(1, 'Type something to search').max(Limits.SEARCH_QUERY_MAX),
});

export const conversationParams = z.object({ conversationId: uuid });
export const memberParams = z.object({ conversationId: uuid, userId: uuid });
export const attachmentParams = z.object({ attachmentId: uuid });

export const directBody = z.object({ userId: uuid }).strict();

export const createGroupBody = z.object({ name: groupName, memberIds: userIdList.default([]) }).strict();

export const updateGroupBody = z
  .object({ name: groupName.optional(), avatarUrl: avatarUrl.nullable().optional() })
  .strict()
  .refine((value) => value.name !== undefined || value.avatarUrl !== undefined, {
    message: 'Nothing to update',
  });

export const addMembersBody = z.object({ userIds: userIdList.pipe(z.array(uuid).min(1)) }).strict();

// OWNER is deliberately not accepted here: ownership only moves through the
// transfer endpoint, which also demotes the previous owner.
export const changeRoleBody = z.object({ role: z.enum([Role.ADMIN, Role.MEMBER]) }).strict();

export const transferBody = z.object({ userId: uuid }).strict();

export const messagesQuery = z
  .object({
    before: cursor.optional(),
    after: cursor.optional(),
    limit: z.coerce.number().int().min(1).max(Limits.PAGE_SIZE_MAX).default(Limits.PAGE_SIZE_DEFAULT),
  })
  .refine((value) => value.before === undefined || value.after === undefined, {
    message: 'Use either "before" or "after", not both',
  });
