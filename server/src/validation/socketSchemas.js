import { z } from 'zod';
import { ClientEvent, REACTION_EMOJIS, ReactionAction } from '../shared.js';
import { messageBody, nonEmptyMessageBody, seq, uuid } from './common.js';

const watermark = z.object({ conversationId: uuid, seq }).strict();
const typing = z.object({ conversationId: uuid }).strict();

/**
 * One schema per client -> server event, keyed by event name. A handler cannot
 * be registered without one (see realtime/handlers.js), so no socket payload
 * reaches business logic unvalidated. Shapes are documented in shared/events.js.
 */
export const socketSchemas = Object.freeze({
  [ClientEvent.MESSAGE_SEND]: z
    .object({
      id: uuid,
      conversationId: uuid,
      body: messageBody.default(''),
      attachmentId: uuid.optional(),
    })
    .strict()
    .refine((value) => value.body.length > 0 || value.attachmentId !== undefined, {
      message: 'A message needs text or an attachment',
      path: ['body'],
    }),

  [ClientEvent.MESSAGE_EDIT]: z.object({ messageId: uuid, body: nonEmptyMessageBody }).strict(),

  [ClientEvent.MESSAGE_DELETE]: z.object({ messageId: uuid }).strict(),

  [ClientEvent.MESSAGE_REACT]: z
    .object({
      messageId: uuid,
      emoji: z.enum(REACTION_EMOJIS),
      action: z.enum([ReactionAction.ADD, ReactionAction.REMOVE]),
    })
    .strict(),

  [ClientEvent.CONVERSATION_READ]: watermark,
  [ClientEvent.CONVERSATION_DELIVERED]: watermark,
  [ClientEvent.TYPING_START]: typing,
  [ClientEvent.TYPING_STOP]: typing,

  [ClientEvent.AUTH_REFRESH]: z.object({ token: z.string().min(1).max(2048) }).strict(),
});
