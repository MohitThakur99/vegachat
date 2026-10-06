/**
 * Group management. Every function follows the same shape:
 *
 *   1. open a transaction and lock the conversation as the acting user
 *      (membership check + their current role, see access.js);
 *   2. decide with the pure rules in shared/permissions.js;
 *   3. write;
 *   4. after commit, update socket rooms and tell the affected clients.
 *
 * The REST routes are thin wrappers around these functions, so the rules live
 * in exactly one place.
 */
import { withTransaction } from '../db/pool.js';
import {
  ConversationType,
  GroupAction,
  Limits,
  RemovalReason,
  Role,
  ServerEvent,
  can,
  canChangeRole,
  canRemoveMember,
  canTransferOwnership,
} from '../shared.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { removeFiles } from '../lib/storage.js';
import * as gateway from '../realtime/gateway.js';
import { lockGroupAs } from './access.js';
import { announceConversation, getConversationDetail, listMembers } from './conversationService.js';
import { getMessageById, insertSystemMessage } from './messageService.js';
import { getDisplayNames } from './userService.js';

function assertCan(role, action, message) {
  if (!can(role, action)) throw forbidden(message);
}

/** "Priya", "Priya and Arjun", "Priya, Arjun and Sneha". */
function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

async function getRole(client, conversationId, userId) {
  const { rows } = await client.query(
    'SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, userId],
  );
  return rows[0]?.role ?? null;
}

async function setRole(client, conversationId, userId, role) {
  await client.query('UPDATE conversation_members SET role = $3 WHERE conversation_id = $1 AND user_id = $2', [
    conversationId,
    userId,
    role,
  ]);
}

/** Broadcasts a system message written inside a transaction that has committed. */
async function broadcastSystemMessage(conversationId, messageId) {
  const message = await getMessageById(messageId);
  if (message) gateway.emitToConversation(conversationId, ServerEvent.MESSAGE_NEW, { message });
}

/** Any signed-in user may create a group; they become its owner. */
export async function createGroup(actorId, { name, memberIds }) {
  const otherIds = memberIds.filter((id) => id !== actorId);
  const allIds = [actorId, ...otherIds];
  if (allIds.length > Limits.GROUP_MAX_MEMBERS) {
    throw badRequest(`A group can have at most ${Limits.GROUP_MAX_MEMBERS} members`);
  }

  const conversationId = await withTransaction(async (client) => {
    const names = await getDisplayNames(allIds, client);
    if (names.size !== allIds.length) throw badRequest('One or more of those users do not exist');

    const { rows } = await client.query(
      'INSERT INTO conversations (type, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [ConversationType.GROUP, name, actorId],
    );
    const { id } = rows[0];

    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       SELECT $1::uuid, member_id, CASE WHEN member_id = $2::uuid THEN $4::text ELSE $5::text END
       FROM unnest($3::uuid[]) AS member_id`,
      [id, actorId, allIds, Role.OWNER, Role.MEMBER],
    );
    await insertSystemMessage(client, id, actorId, `${names.get(actorId)} created the group`);
    return id;
  });

  gateway.joinUsersToConversation(allIds, conversationId);
  await announceConversation(conversationId, allIds);
  return getConversationDetail(actorId, conversationId);
}

/** Admins and the owner. New members join as plain members. */
export async function addMembers(actorId, conversationId, { userIds }) {
  const { addedIds, messageId } = await withTransaction(async (client) => {
    const group = await lockGroupAs(client, conversationId, actorId);
    assertCan(group.role, GroupAction.ADD_MEMBER, 'Only admins and the owner can add members');

    const candidateIds = userIds.filter((id) => id !== actorId);
    const names = await getDisplayNames([actorId, ...candidateIds], client);
    if (candidateIds.some((id) => !names.has(id))) throw badRequest('One or more of those users do not exist');

    // New members start with everything already in the group marked as read,
    // so joining does not show hundreds of unread messages.
    const inserted = await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role, last_read_seq, last_delivered_seq)
       SELECT $1::uuid, member_id, $3::text, $4::bigint, $4::bigint FROM unnest($2::uuid[]) AS member_id
       ON CONFLICT DO NOTHING
       RETURNING user_id`,
      [conversationId, candidateIds, Role.MEMBER, group.last_message_seq],
    );
    const added = inserted.rows.map((row) => row.user_id);
    if (added.length === 0) throw conflict('Those users are already in the group');

    const total = await client.query(
      'SELECT count(*) AS count FROM conversation_members WHERE conversation_id = $1',
      [conversationId],
    );
    if (total.rows[0].count > Limits.GROUP_MAX_MEMBERS) {
      throw badRequest(`A group can have at most ${Limits.GROUP_MAX_MEMBERS} members`);
    }

    const text = `${names.get(actorId)} added ${joinNames(added.map((id) => names.get(id)))}`;
    return { addedIds: added, messageId: await insertSystemMessage(client, conversationId, actorId, text) };
  });

  gateway.joinUsersToConversation(addedIds, conversationId);
  await announceConversation(conversationId, addedIds);

  const members = await listMembers(conversationId, addedIds);
  gateway.emitToConversation(conversationId, ServerEvent.MEMBER_ADDED, { conversationId, members });
  await broadcastSystemMessage(conversationId, messageId);
  return { members };
}

/**
 * Removes `targetId` from the group. When the target is the actor this is
 * "leave group". The target's sockets are taken out of the room before anyone
 * is notified, so nothing sent afterwards can reach them.
 */
export async function removeMember(actorId, conversationId, targetId) {
  const leaving = targetId === actorId;

  const messageId = await withTransaction(async (client) => {
    const group = await lockGroupAs(client, conversationId, actorId);

    if (leaving) {
      assertCan(
        group.role,
        GroupAction.LEAVE_GROUP,
        'Transfer ownership or delete the group before leaving',
      );
    } else {
      const targetRole = await getRole(client, conversationId, targetId);
      if (!targetRole) throw notFound('That user is not in this group');
      if (!canRemoveMember(group.role, targetRole)) {
        throw forbidden(
          can(group.role, GroupAction.REMOVE_MEMBER)
            ? `You cannot remove the group's ${targetRole}`
            : 'Only admins and the owner can remove members',
        );
      }
    }

    const names = await getDisplayNames([actorId, targetId], client);
    await client.query('DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [
      conversationId,
      targetId,
    ]);

    const text = leaving
      ? `${names.get(actorId)} left the group`
      : `${names.get(actorId)} removed ${names.get(targetId)}`;
    return insertSystemMessage(client, conversationId, actorId, text);
  });

  gateway.removeUsersFromConversation([targetId], conversationId);
  gateway.emitToUser(targetId, ServerEvent.CONVERSATION_REMOVED, {
    conversationId,
    reason: leaving ? RemovalReason.LEFT : RemovalReason.REMOVED,
  });
  gateway.emitToConversation(conversationId, ServerEvent.MEMBER_REMOVED, { conversationId, userId: targetId });
  await broadcastSystemMessage(conversationId, messageId);
}

/** Owner only: promote a member to admin or demote an admin to member. */
export async function changeMemberRole(actorId, conversationId, targetId, { role }) {
  const messageId = await withTransaction(async (client) => {
    const group = await lockGroupAs(client, conversationId, actorId);
    assertCan(group.role, GroupAction.CHANGE_ROLE, 'Only the owner can change roles');

    const targetRole = await getRole(client, conversationId, targetId);
    if (!targetRole) throw notFound('That user is not in this group');
    if (targetRole === role) throw conflict(`That user is already ${role === Role.ADMIN ? 'an admin' : 'a member'}`);
    if (!canChangeRole(group.role, targetRole, role)) throw forbidden("You cannot change the owner's role");

    await setRole(client, conversationId, targetId, role);

    const names = await getDisplayNames([actorId, targetId], client);
    const text =
      role === Role.ADMIN
        ? `${names.get(actorId)} made ${names.get(targetId)} an admin`
        : `${names.get(actorId)} removed ${names.get(targetId)} as admin`;
    return insertSystemMessage(client, conversationId, actorId, text);
  });

  gateway.emitToConversation(conversationId, ServerEvent.MEMBER_ROLE_CHANGED, {
    conversationId,
    changes: [{ userId: targetId, role }],
  });
  await broadcastSystemMessage(conversationId, messageId);
}

/** Owner only. The previous owner stays in the group as an admin. */
export async function transferOwnership(actorId, conversationId, { userId: targetId }) {
  const messageId = await withTransaction(async (client) => {
    const group = await lockGroupAs(client, conversationId, actorId);
    assertCan(group.role, GroupAction.TRANSFER_OWNERSHIP, 'Only the owner can transfer ownership');
    if (targetId === actorId) throw badRequest('You already own this group');

    const targetRole = await getRole(client, conversationId, targetId);
    if (!targetRole) throw notFound('That user is not in this group');
    if (!canTransferOwnership(group.role, targetRole)) throw forbidden('Ownership cannot be transferred to that user');

    // Demote first: the one-owner unique index is checked per statement.
    await setRole(client, conversationId, actorId, Role.ADMIN);
    await setRole(client, conversationId, targetId, Role.OWNER);

    const names = await getDisplayNames([actorId, targetId], client);
    const text = `${names.get(actorId)} made ${names.get(targetId)} the group owner`;
    return insertSystemMessage(client, conversationId, actorId, text);
  });

  gateway.emitToConversation(conversationId, ServerEvent.MEMBER_ROLE_CHANGED, {
    conversationId,
    changes: [
      { userId: actorId, role: Role.ADMIN },
      { userId: targetId, role: Role.OWNER },
    ],
  });
  await broadcastSystemMessage(conversationId, messageId);
}

/** Admins and the owner: rename the group and/or change its avatar. */
export async function updateGroup(actorId, conversationId, { name, avatarUrl }) {
  const { updated, messageId } = await withTransaction(async (client) => {
    const group = await lockGroupAs(client, conversationId, actorId);
    assertCan(group.role, GroupAction.UPDATE_GROUP, 'Only admins and the owner can edit the group');

    const nextName = name ?? group.name;
    const nextAvatarUrl = avatarUrl === undefined ? group.avatar_url : avatarUrl;
    const renamed = nextName !== group.name;
    const avatarChanged = nextAvatarUrl !== group.avatar_url;
    const result = { updated: { conversationId, name: nextName, avatarUrl: nextAvatarUrl }, messageId: null };
    if (!renamed && !avatarChanged) return result;

    await client.query('UPDATE conversations SET name = $2, avatar_url = $3 WHERE id = $1', [
      conversationId,
      nextName,
      nextAvatarUrl,
    ]);

    const names = await getDisplayNames([actorId], client);
    const text = renamed
      ? `${names.get(actorId)} renamed the group to “${nextName}”`
      : `${names.get(actorId)} changed the group picture`;
    result.messageId = await insertSystemMessage(client, conversationId, actorId, text);
    return result;
  });

  if (messageId) {
    gateway.emitToConversation(conversationId, ServerEvent.CONVERSATION_UPDATED, updated);
    await broadcastSystemMessage(conversationId, messageId);
  }
  return updated;
}

/** Owner only. Deletes the group with all of its messages and files. */
export async function deleteGroup(actorId, conversationId) {
  const storageKeys = await withTransaction(async (client) => {
    const group = await lockGroupAs(client, conversationId, actorId);
    assertCan(group.role, GroupAction.DELETE_GROUP, 'Only the owner can delete the group');

    const files = await client.query('SELECT storage_key FROM attachments WHERE conversation_id = $1', [
      conversationId,
    ]);
    // Members, messages, reactions and attachment rows go with it (ON DELETE CASCADE).
    await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    return files.rows.map((row) => row.storage_key);
  });

  gateway.emitToConversation(conversationId, ServerEvent.CONVERSATION_REMOVED, {
    conversationId,
    reason: RemovalReason.DELETED,
  });
  gateway.closeConversation(conversationId);
  await removeFiles(storageKeys);
}
