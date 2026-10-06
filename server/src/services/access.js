/**
 * Membership checks. Every REST handler and every socket handler that touches
 * a conversation goes through one of these two functions; there is no other
 * route to conversation data.
 */
import { pool } from '../db/pool.js';
import { ConversationType } from '../shared.js';
import { badRequest, forbidden } from '../lib/errors.js';

// One message for "does not exist" and "exists but you are not in it", so the
// response cannot be used to probe for conversation ids.
const notAMember = () => forbidden('You are not a member of this conversation');

const MEMBERSHIP_SQL = `
  SELECT c.id, c.type, c.name, c.avatar_url, c.last_message_seq, m.role
  FROM conversations c
  JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $2
  WHERE c.id = $1`;

/**
 * @typedef {object} Membership
 * @property {string} id                 Conversation id.
 * @property {string} type               One of `ConversationType`.
 * @property {string|null} name
 * @property {string|null} avatar_url
 * @property {number} last_message_seq
 * @property {string} role               The user's role, one of `Role`.
 */

/**
 * For reads.
 * @returns {Promise<Membership>}
 * @throws {AppError} FORBIDDEN when the user is not a member.
 */
export async function requireMembership(conversationId, userId, db = pool) {
  const { rows } = await db.query(MEMBERSHIP_SQL, [conversationId, userId]);
  if (!rows[0]) throw notAMember();
  return rows[0];
}

/**
 * For writes. Checks membership and locks the conversation row until the
 * surrounding transaction ends. Because every write to a conversation takes
 * this lock first:
 *   - the role read here cannot change before the write commits, so there is
 *     no window between "check permission" and "act";
 *   - messages get their seq in commit order within the conversation.
 *
 * @param {import('pg').PoolClient} client  A client inside a transaction.
 * @returns {Promise<Membership>}
 * @throws {AppError} FORBIDDEN when the user is not a member.
 */
export async function lockConversationAs(client, conversationId, userId) {
  const { rows } = await client.query(`${MEMBERSHIP_SQL} FOR UPDATE OF c`, [conversationId, userId]);
  if (!rows[0]) throw notAMember();
  return rows[0];
}

/** Like `lockConversationAs`, and also rejects direct conversations. */
export async function lockGroupAs(client, conversationId, userId) {
  const membership = await lockConversationAs(client, conversationId, userId);
  if (membership.type !== ConversationType.GROUP) {
    throw badRequest('This action is only available in group conversations');
  }
  return membership;
}
