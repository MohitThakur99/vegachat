import { pool, query, withTransaction } from '../db/pool.js';
import { ConversationType, Role, ServerEvent } from '../shared.js';
import { badRequest, notFound } from '../lib/errors.js';
import * as gateway from '../realtime/gateway.js';
import { requireMembership } from './access.js';
import { isOnline } from './presence.js';

const PREVIEW_LENGTH = 140;

/** @returns {Promise<string[]>} ids of every conversation the user is in. */
export async function listConversationIds(userId) {
  const { rows } = await query('SELECT conversation_id FROM conversation_members WHERE user_id = $1', [userId]);
  return rows.map((row) => row.conversation_id);
}

/**
 * Conversations as seen by `userId`, newest activity first. Pass
 * `conversationId` to load just one; the result is empty if the user is not
 * in it, so this doubles as a membership-scoped read.
 *
 * @returns {Promise<import('../shared.js').Conversation[]>}
 */
export async function listConversations(userId, { conversationId = null } = {}) {
  const { rows } = await query(
    `SELECT c.id, c.type, c.name, c.avatar_url, c.last_message_seq, c.last_activity_at, c.created_at,
            me.role, me.last_read_seq,
            (SELECT count(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) AS member_count,
            (SELECT count(*) FROM messages x
              WHERE x.conversation_id = c.id AND x.seq > me.last_read_seq
                AND x.sender_id <> me.user_id AND x.deleted_at IS NULL) AS unread_count,
            last_message.preview AS last_message,
            peer.profile AS peer
     FROM conversation_members me
     JOIN conversations c ON c.id = me.conversation_id
     LEFT JOIN LATERAL (
       SELECT json_build_object(
                'id', m.id, 'seq', m.seq, 'senderId', m.sender_id, 'senderName', u.display_name,
                'type', m.type, 'body', left(m.body, $3), 'createdAt', m.created_at, 'deletedAt', m.deleted_at,
                'hasAttachment', EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)
              ) AS preview
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = c.id
       ORDER BY m.seq DESC
       LIMIT 1
     ) last_message ON true
     LEFT JOIN LATERAL (
       SELECT json_build_object(
                'id', u.id, 'displayName', u.display_name, 'avatarUrl', u.avatar_url,
                'lastSeenAt', u.last_seen_at, 'lastReadSeq', other.last_read_seq,
                'lastDeliveredSeq', other.last_delivered_seq, 'joinedAt', other.joined_at
              ) AS profile
       FROM conversation_members other
       JOIN users u ON u.id = other.user_id
       WHERE c.type = 'direct' AND other.conversation_id = c.id AND other.user_id <> me.user_id
       LIMIT 1
     ) peer ON true
     WHERE me.user_id = $1 AND ($2::uuid IS NULL OR c.id = $2)
     ORDER BY c.last_activity_at DESC`,
    [userId, conversationId, PREVIEW_LENGTH],
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role,
    memberCount: row.member_count,
    lastMessageSeq: row.last_message_seq,
    lastReadSeq: row.last_read_seq,
    unreadCount: row.unread_count,
    lastMessage: row.last_message,
    peer: row.peer ? { ...row.peer, online: isOnline(row.peer.id) } : null,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
  }));
}

/**
 * Members of a conversation: owner, then admins, then members by name. The
 * caller is responsible for the membership check.
 *
 * @param {string[]} [onlyUserIds]  Restrict to these users.
 * @returns {Promise<import('../shared.js').Member[]>}
 */
export async function listMembers(conversationId, onlyUserIds = null) {
  const { rows } = await query(
    `SELECT u.id, u.display_name, u.avatar_url, u.last_seen_at,
            m.role, m.last_read_seq, m.last_delivered_seq, m.joined_at
     FROM conversation_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.conversation_id = $1 AND ($2::uuid[] IS NULL OR m.user_id = ANY($2))
     ORDER BY CASE m.role WHEN '${Role.OWNER}' THEN 0 WHEN '${Role.ADMIN}' THEN 1 ELSE 2 END,
              lower(u.display_name)`,
    [conversationId, onlyUserIds],
  );
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    lastReadSeq: row.last_read_seq,
    lastDeliveredSeq: row.last_delivered_seq,
    online: isOnline(row.id),
    lastSeenAt: row.last_seen_at,
    joinedAt: row.joined_at,
  }));
}

/** @returns {Promise<{conversation: import('../shared.js').Conversation, members: import('../shared.js').Member[]}>} */
export async function getConversationDetail(userId, conversationId) {
  await requireMembership(conversationId, userId);
  const [[conversation], members] = await Promise.all([
    listConversations(userId, { conversationId }),
    listMembers(conversationId),
  ]);
  // Removed between the check and the read.
  if (!conversation) throw notFound('Conversation not found');
  return { conversation, members };
}

/** Sends each user their own view of a conversation they have just gained. */
export async function announceConversation(conversationId, userIds) {
  await Promise.all(
    userIds.map(async (userId) => {
      const [conversation] = await listConversations(userId, { conversationId });
      if (conversation) gateway.emitToUser(userId, ServerEvent.CONVERSATION_ADDED, { conversation });
    }),
  );
}

/**
 * Opens the direct conversation between two users, creating it on first use.
 * Uniqueness comes from the UNIQUE constraint on `direct_key`, not from a
 * "does it exist?" read, so two simultaneous requests cannot create two rows.
 *
 * @returns {Promise<{conversation: import('../shared.js').Conversation, created: boolean}>}
 */
export async function openDirectConversation(userId, peerId) {
  if (peerId === userId) throw badRequest('You cannot start a conversation with yourself');

  const peer = await pool.query('SELECT 1 FROM users WHERE id = $1', [peerId]);
  if (peer.rowCount === 0) throw notFound('User not found');

  const directKey = [userId, peerId].sort().join(':');

  const { id, created } = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO conversations (type, direct_key, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (direct_key) DO NOTHING
       RETURNING id`,
      [ConversationType.DIRECT, directKey, userId],
    );
    if (inserted.rows[0]) {
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, $4), ($1, $3, $4)`,
        [inserted.rows[0].id, userId, peerId, Role.MEMBER],
      );
      return { id: inserted.rows[0].id, created: true };
    }
    const existing = await client.query('SELECT id FROM conversations WHERE direct_key = $1', [directKey]);
    return { id: existing.rows[0].id, created: false };
  });

  if (created) {
    gateway.joinUsersToConversation([userId, peerId], id);
    await announceConversation(id, [userId, peerId]);
  }

  const [conversation] = await listConversations(userId, { conversationId: id });
  return { conversation, created };
}
