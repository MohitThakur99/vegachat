import { pool, query, withTransaction } from '../db/pool.js';
import { Limits, MessageType, ReactionAction } from '../shared.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { removeFiles } from '../lib/storage.js';
import { lockConversationAs, requireMembership } from './access.js';

const UNIQUE_VIOLATION = '23505';

const MESSAGE_SELECT = `
  SELECT m.id, m.seq, m.conversation_id, m.sender_id, m.type, m.body,
         m.created_at, m.edited_at, m.deleted_at,
         json_build_object('id', u.id, 'displayName', u.display_name, 'avatarUrl', u.avatar_url) AS sender,
         COALESCE((
           SELECT json_agg(json_build_object('emoji', r.emoji, 'userIds', r.user_ids) ORDER BY r.first_at)
           FROM (
             SELECT emoji, json_agg(user_id ORDER BY created_at) AS user_ids, min(created_at) AS first_at
             FROM message_reactions
             WHERE message_id = m.id
             GROUP BY emoji
           ) r
         ), '[]'::json) AS reactions,
         (
           SELECT json_build_object('id', a.id, 'name', a.original_name, 'mimeType', a.mime_type, 'size', a.size_bytes)
           FROM attachments a
           WHERE a.message_id = m.id
         ) AS attachment
  FROM messages m
  JOIN users u ON u.id = m.sender_id`;

/** @returns {import('../shared.js').Message} */
const toMessage = (row) => ({
  id: row.id,
  seq: row.seq,
  conversationId: row.conversation_id,
  senderId: row.sender_id,
  sender: row.sender,
  type: row.type,
  body: row.body,
  attachment: row.attachment,
  reactions: row.reactions,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  deletedAt: row.deleted_at,
});

export async function getMessageById(messageId, db = pool) {
  const { rows } = await db.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [messageId]);
  return rows[0] ? toMessage(rows[0]) : null;
}

/**
 * Inserts a message and advances the conversation and the sender's own
 * watermarks (you have read what you wrote). The caller must already hold the
 * conversation lock.
 *
 * @returns {Promise<{id: string, seq: number}>}
 */
async function insertMessage(client, { id, conversationId, senderId, type, body }) {
  const { rows } = await client.query(
    `INSERT INTO messages (id, conversation_id, sender_id, type, body)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5)
     RETURNING id, seq`,
    [id ?? null, conversationId, senderId, type, body],
  );
  const { seq } = rows[0];
  await client.query(
    'UPDATE conversations SET last_message_seq = $2, last_activity_at = now() WHERE id = $1',
    [conversationId, seq],
  );
  await client.query(
    `UPDATE conversation_members SET last_read_seq = $3, last_delivered_seq = $3
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, senderId, seq],
  );
  return rows[0];
}

/**
 * Writes a "Rahul added Priya" style message. The caller must hold the
 * conversation lock.
 *
 * @returns {Promise<string>} the message id; load it after commit to broadcast.
 */
export async function insertSystemMessage(client, conversationId, actorId, body) {
  const { id } = await insertMessage(client, {
    conversationId,
    senderId: actorId,
    type: MessageType.SYSTEM,
    body,
  });
  return id;
}

/**
 * @param {string} userId
 * @param {import('../shared.js').MessageSendPayload} input  Already validated.
 * @returns {Promise<{message: import('../shared.js').Message, duplicate: boolean}>}
 *   `duplicate` is true when this id was stored by an earlier attempt; the
 *   caller must not broadcast it again.
 */
export async function sendMessage(userId, { id, conversationId, body, attachmentId }) {
  try {
    return await withTransaction(async (client) => {
      await lockConversationAs(client, conversationId, userId);

      const existing = await client.query('SELECT sender_id, conversation_id FROM messages WHERE id = $1', [id]);
      if (existing.rows[0]) {
        const { sender_id: senderId, conversation_id: existingConversationId } = existing.rows[0];
        if (senderId !== userId || existingConversationId !== conversationId) {
          throw conflict('That message id is already in use');
        }
        return { message: await getMessageById(id, client), duplicate: true };
      }

      await insertMessage(client, { id, conversationId, senderId: userId, type: MessageType.TEXT, body });

      if (attachmentId) {
        // One statement checks ownership, conversation and "not used yet", and claims it.
        const claimed = await client.query(
          `UPDATE attachments SET message_id = $1
           WHERE id = $2 AND uploader_id = $3 AND conversation_id = $4 AND message_id IS NULL`,
          [id, attachmentId, userId, conversationId],
        );
        if (claimed.rowCount === 0) throw badRequest('That attachment is not available');
      }

      return { message: await getMessageById(id, client), duplicate: false };
    });
  } catch (err) {
    // The same id sent to two different conversations at the same instant.
    if (err.code === UNIQUE_VIOLATION) throw conflict('That message id is already in use');
    throw err;
  }
}

/**
 * Cursor pagination on `seq`.
 *   no cursor   the newest page
 *   before=seq  the page just older than seq (scrolling up)
 *   after=seq   the page just newer than seq (catching up)
 * Messages are always returned oldest first.
 */
export async function listMessages(userId, conversationId, { before, after, limit }) {
  await requireMembership(conversationId, userId);

  // One extra row tells us whether another page exists without a count query.
  const fetchLimit = limit + 1;
  let rows;
  if (after !== undefined) {
    ({ rows } = await query(
      `${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.seq > $2 ORDER BY m.seq ASC LIMIT $3`,
      [conversationId, after, fetchLimit],
    ));
  } else {
    ({ rows } = await query(
      `${MESSAGE_SELECT}
       WHERE m.conversation_id = $1 AND ($2::bigint IS NULL OR m.seq < $2)
       ORDER BY m.seq DESC LIMIT $3`,
      [conversationId, before ?? null, fetchLimit],
    ));
  }

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map(toMessage);
  if (after === undefined) page.reverse();

  return { messages: page, hasMore };
}

/**
 * Loads a message for a write and locks its conversation, proving the user is
 * still a member. Unknown ids and other people's conversations look the same.
 */
async function lockMessageAs(client, messageId, userId) {
  const found = await client.query('SELECT conversation_id FROM messages WHERE id = $1', [messageId]);
  if (!found.rows[0]) throw notFound('Message not found');

  try {
    await lockConversationAs(client, found.rows[0].conversation_id, userId);
  } catch (err) {
    if (err instanceof AppError) throw notFound('Message not found');
    throw err;
  }

  // Read the message only once the lock is held, so a concurrent edit or
  // delete of the same message cannot be acted on from a stale copy.
  const { rows } = await client.query(
    `SELECT id, conversation_id, sender_id, type, body, deleted_at,
            (now() - created_at) <= ($2::int * interval '1 millisecond') AS within_delete_window
     FROM messages WHERE id = $1`,
    [messageId, Limits.DELETE_WINDOW_MS],
  );
  if (!rows[0]) throw notFound('Message not found');
  return rows[0];
}

export async function editMessage(userId, { messageId, body }) {
  return withTransaction(async (client) => {
    const message = await lockMessageAs(client, messageId, userId);
    if (message.sender_id !== userId) throw forbidden('You can only edit your own messages');
    if (message.type !== MessageType.TEXT) throw badRequest('This message cannot be edited');
    if (message.deleted_at) throw conflict('This message was deleted');

    const changed = message.body !== body;
    if (changed) {
      await client.query('UPDATE messages SET body = $2, edited_at = now() WHERE id = $1', [messageId, body]);
    }
    return { message: await getMessageById(messageId, client), changed };
  });
}

/**
 * "Delete for everyone". The row stays as a tombstone; the text, reactions
 * and attachment are destroyed.
 */
export async function deleteMessage(userId, { messageId }) {
  const result = await withTransaction(async (client) => {
    const message = await lockMessageAs(client, messageId, userId);
    if (message.sender_id !== userId) throw forbidden('You can only delete your own messages');
    if (message.type !== MessageType.TEXT) throw badRequest('This message cannot be deleted');

    const base = { conversationId: message.conversation_id, messageId };
    if (message.deleted_at) {
      return { ...base, deletedAt: message.deleted_at, changed: false, storageKeys: [] };
    }
    if (!message.within_delete_window) {
      const minutes = Limits.DELETE_WINDOW_MS / 60_000;
      throw forbidden(`Messages can only be deleted within ${minutes} minutes of sending`);
    }

    const { rows } = await client.query(
      "UPDATE messages SET body = '', deleted_at = now() WHERE id = $1 RETURNING deleted_at",
      [messageId],
    );
    await client.query('DELETE FROM message_reactions WHERE message_id = $1', [messageId]);
    const removed = await client.query('DELETE FROM attachments WHERE message_id = $1 RETURNING storage_key', [
      messageId,
    ]);

    return {
      ...base,
      deletedAt: rows[0].deleted_at,
      changed: true,
      storageKeys: removed.rows.map((row) => row.storage_key),
    };
  });

  const { storageKeys, ...outcome } = result;
  await removeFiles(storageKeys);
  return outcome;
}

/** @returns {Promise<{conversationId: string, changed: boolean}>} */
export async function reactToMessage(userId, { messageId, emoji, action }) {
  return withTransaction(async (client) => {
    const message = await lockMessageAs(client, messageId, userId);
    if (message.type !== MessageType.TEXT) throw badRequest('You cannot react to this message');
    if (message.deleted_at) throw conflict('This message was deleted');

    const result =
      action === ReactionAction.ADD
        ? await client.query(
            `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [messageId, userId, emoji],
          )
        : await client.query(
            'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
            [messageId, userId, emoji],
          );

    return { conversationId: message.conversation_id, changed: result.rowCount > 0 };
  });
}

/**
 * Moves a member's watermarks forward to `seq`. They never move backwards and
 * never beyond the newest message, so a client cannot claim to have read
 * messages that do not exist yet. Reading implies delivery.
 *
 * @param {'read'|'delivered'} kind
 * @returns {Promise<import('../shared.js').ReceiptUpdatePayload & {changed: boolean}>}
 */
export async function advanceWatermark(userId, { conversationId, seq }, kind) {
  const { rows } = await query(
    `WITH previous AS (
       SELECT last_read_seq, last_delivered_seq
       FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2
       FOR UPDATE
     )
     UPDATE conversation_members m
     SET last_read_seq = CASE WHEN $4 THEN GREATEST(m.last_read_seq, LEAST($3, c.last_message_seq))
                              ELSE m.last_read_seq END,
         last_delivered_seq = GREATEST(m.last_delivered_seq, LEAST($3, c.last_message_seq))
     FROM conversations c, previous
     WHERE c.id = m.conversation_id AND m.conversation_id = $1 AND m.user_id = $2
     RETURNING m.last_read_seq, m.last_delivered_seq,
               previous.last_read_seq AS previous_read, previous.last_delivered_seq AS previous_delivered`,
    [conversationId, userId, seq, kind === 'read'],
  );
  const row = rows[0];
  if (!row) throw forbidden('You are not a member of this conversation');

  return {
    conversationId,
    userId,
    lastReadSeq: row.last_read_seq,
    lastDeliveredSeq: row.last_delivered_seq,
    changed: row.last_read_seq !== row.previous_read || row.last_delivered_seq !== row.previous_delivered,
  };
}

/**
 * Called when a user comes online: everything sent while they were away has
 * now reached a device.
 *
 * @returns {Promise<import('../shared.js').ReceiptUpdatePayload[]>} one entry per conversation that changed.
 */
export async function markAllDelivered(userId) {
  const { rows } = await query(
    `UPDATE conversation_members m
     SET last_delivered_seq = c.last_message_seq
     FROM conversations c
     WHERE c.id = m.conversation_id AND m.user_id = $1 AND m.last_delivered_seq < c.last_message_seq
     RETURNING m.conversation_id, m.last_read_seq, m.last_delivered_seq`,
    [userId],
  );
  return rows.map((row) => ({
    conversationId: row.conversation_id,
    userId,
    lastReadSeq: row.last_read_seq,
    lastDeliveredSeq: row.last_delivered_seq,
  }));
}
