import { ClientEvent, ErrorCode, Limits, ServerEvent } from '../shared.js';
import { describeError, forbidden, rateLimited, unauthenticated } from '../lib/errors.js';
import { TokenBucket } from '../lib/rateLimiter.js';
import { verifyAccessToken } from '../lib/tokens.js';
import * as messageService from '../services/messageService.js';
import { socketSchemas } from '../validation/socketSchemas.js';
import * as gateway from './gateway.js';
import { scheduleTokenExpiry } from './tokenExpiry.js';

/** Per-socket budgets, by the kind of work an event causes. */
const RATE_LIMITS = Object.freeze({
  /** Writes a message row and fans out to a room. */
  message: { capacity: 20, refillPerSecond: 2 },
  /** Cheap, frequent signals: typing, receipts, reactions. */
  signal: { capacity: 40, refillPerSecond: 10 },
});

/**
 * Registers every client -> server event for one socket.
 *
 * `on` is the single doorway. In order, for every event it:
 *   1. rejects it if the socket's access token has expired;
 *   2. applies the rate limit;
 *   3. validates the payload against the event's zod schema;
 *   4. runs the handler, which does the membership / ownership check for the
 *      specific conversation or message through the service layer;
 *   5. answers with `{ ok: true, data }` or `{ ok: false, error }`.
 *
 * The user is always `socket.data.userId`, set from the verified token at
 * handshake. No payload has a "from" or "userId" field for a client to forge.
 */
export function registerHandlers(socket) {
  const { userId } = socket.data;
  const buckets = {
    message: new TokenBucket(RATE_LIMITS.message),
    signal: new TokenBucket(RATE_LIMITS.signal),
  };
  /** conversationId -> when this socket last announced "typing". */
  const typingSince = new Map();

  function on(event, bucket, handler) {
    const schema = socketSchemas[event];
    if (!schema) throw new Error(`No validation schema for socket event "${event}"`);

    socket.on(event, async (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : () => {};
      try {
        if (event !== ClientEvent.AUTH_REFRESH && Date.now() >= socket.data.tokenExpiresAt) {
          throw unauthenticated('Access token expired', ErrorCode.TOKEN_EXPIRED);
        }
        if (!buckets[bucket].take()) throw rateLimited();
        const data = schema.parse(payload);
        respond({ ok: true, data: (await handler(data)) ?? null });
      } catch (err) {
        const { body, expected } = describeError(err);
        if (!expected) console.error(`Socket event "${event}" failed`, err);
        respond({ ok: false, error: body });
      }
    });
  }

  /**
   * Membership check for signals that are not worth a database round trip.
   * Room membership mirrors the database: sockets are joined from it at
   * connect and when added to a group, and are removed the moment a user is
   * removed (see gateway.js).
   */
  function requireRoom(conversationId) {
    if (!socket.rooms.has(gateway.rooms.conversation(conversationId))) {
      throw forbidden('You are not a member of this conversation');
    }
  }

  function broadcastTyping(conversationId, isTyping) {
    socket.to(gateway.rooms.conversation(conversationId)).emit(ServerEvent.TYPING_UPDATE, {
      conversationId,
      userId,
      displayName: socket.data.displayName,
      isTyping,
    });
  }

  on(ClientEvent.MESSAGE_SEND, 'message', async (data) => {
    const { message, duplicate } = await messageService.sendMessage(userId, data);
    // A retry of something already stored is acknowledged but not re-broadcast.
    if (!duplicate) {
      gateway.emitToConversation(message.conversationId, ServerEvent.MESSAGE_NEW, { message });
    }
    return { message };
  });

  on(ClientEvent.MESSAGE_EDIT, 'message', async (data) => {
    const { message, changed } = await messageService.editMessage(userId, data);
    if (changed) {
      gateway.emitToConversation(message.conversationId, ServerEvent.MESSAGE_UPDATED, { message });
    }
    return { message };
  });

  on(ClientEvent.MESSAGE_DELETE, 'message', async (data) => {
    const { changed, ...deleted } = await messageService.deleteMessage(userId, data);
    if (changed) gateway.emitToConversation(deleted.conversationId, ServerEvent.MESSAGE_DELETED, deleted);
    return deleted;
  });

  on(ClientEvent.MESSAGE_REACT, 'signal', async (data) => {
    const { conversationId, changed } = await messageService.reactToMessage(userId, data);
    if (changed) {
      gateway.emitToConversation(conversationId, ServerEvent.MESSAGE_REACTION, {
        conversationId,
        messageId: data.messageId,
        userId,
        emoji: data.emoji,
        action: data.action,
      });
    }
  });

  for (const [event, kind] of [
    [ClientEvent.CONVERSATION_READ, 'read'],
    [ClientEvent.CONVERSATION_DELIVERED, 'delivered'],
  ]) {
    on(event, 'signal', async (data) => {
      const { changed, ...receipt } = await messageService.advanceWatermark(userId, data, kind);
      if (changed) gateway.emitToConversation(receipt.conversationId, ServerEvent.RECEIPT_UPDATE, receipt);
      return receipt;
    });
  }

  on(ClientEvent.TYPING_START, 'signal', ({ conversationId }) => {
    requireRoom(conversationId);
    // Server-side throttle: a client that ignores TYPING_THROTTLE_MS still
    // cannot make the room receive more than one update per window.
    const now = Date.now();
    if (now - (typingSince.get(conversationId) ?? 0) < Limits.TYPING_THROTTLE_MS / 2) return;
    typingSince.set(conversationId, now);
    broadcastTyping(conversationId, true);
  });

  on(ClientEvent.TYPING_STOP, 'signal', ({ conversationId }) => {
    requireRoom(conversationId);
    if (typingSince.delete(conversationId)) broadcastTyping(conversationId, false);
  });

  on(ClientEvent.AUTH_REFRESH, 'signal', ({ token }) => {
    let verified;
    try {
      verified = verifyAccessToken(token);
      // A valid token for somebody else must not re-arm this socket.
      if (verified.userId !== userId) throw unauthenticated('Token belongs to a different user');
    } catch (err) {
      // Let the ack go out first, then drop the connection.
      setImmediate(() => socket.disconnect(true));
      throw err;
    }
    socket.data.tokenExpiresAt = verified.expiresAt;
    scheduleTokenExpiry(socket);
    return { expiresAt: verified.expiresAt };
  });

  // `disconnecting` still has the rooms: clear any "typing…" this socket left behind.
  socket.on('disconnecting', () => {
    for (const conversationId of typingSince.keys()) {
      if (socket.rooms.has(gateway.rooms.conversation(conversationId))) broadcastTyping(conversationId, false);
    }
    typingSince.clear();
  });
}
