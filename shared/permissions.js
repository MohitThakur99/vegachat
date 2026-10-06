/**
 * Group permission rules as pure functions.
 *
 * The server enforces them; the client imports the same functions only to
 * decide which controls to show. Hiding a button is never the security
 * boundary.
 */
import { Role } from './constants.js';

export const GroupAction = Object.freeze({
  READ_MESSAGES: 'messages:read',
  SEND_MESSAGE: 'messages:send',
  LEAVE_GROUP: 'group:leave',
  ADD_MEMBER: 'members:add',
  REMOVE_MEMBER: 'members:remove',
  UPDATE_GROUP: 'group:update',
  CHANGE_ROLE: 'members:change-role',
  TRANSFER_OWNERSHIP: 'group:transfer-ownership',
  DELETE_GROUP: 'group:delete',
});

const RANK = Object.freeze({
  [Role.MEMBER]: 1,
  [Role.ADMIN]: 2,
  [Role.OWNER]: 3,
});

const MEMBER_ACTIONS = [GroupAction.READ_MESSAGES, GroupAction.SEND_MESSAGE, GroupAction.LEAVE_GROUP];

const ADMIN_ACTIONS = [
  ...MEMBER_ACTIONS,
  GroupAction.ADD_MEMBER,
  GroupAction.REMOVE_MEMBER,
  GroupAction.UPDATE_GROUP,
];

// The owner cannot leave: a group must always have exactly one owner, so they
// transfer ownership or delete the group instead.
const OWNER_ACTIONS = [
  ...ADMIN_ACTIONS.filter((action) => action !== GroupAction.LEAVE_GROUP),
  GroupAction.CHANGE_ROLE,
  GroupAction.TRANSFER_OWNERSHIP,
  GroupAction.DELETE_GROUP,
];

export const ROLE_PERMISSIONS = Object.freeze({
  [Role.MEMBER]: Object.freeze(MEMBER_ACTIONS),
  [Role.ADMIN]: Object.freeze(ADMIN_ACTIONS),
  [Role.OWNER]: Object.freeze(OWNER_ACTIONS),
});

const isRole = (role) => Object.hasOwn(RANK, role);

/** Whether `role` may perform `action` at all. Unknown roles can do nothing. */
export function can(role, action) {
  return isRole(role) && ROLE_PERMISSIONS[role].includes(action);
}

/** Whether `actorRole` is strictly senior to `targetRole`. */
export function outranks(actorRole, targetRole) {
  return isRole(actorRole) && isRole(targetRole) && RANK[actorRole] > RANK[targetRole];
}

/**
 * Removing someone else. An admin can remove members but not other admins or
 * the owner; the owner can remove anyone but themselves.
 */
export function canRemoveMember(actorRole, targetRole) {
  return can(actorRole, GroupAction.REMOVE_MEMBER) && outranks(actorRole, targetRole);
}

/** Promote a member to admin or demote an admin to member. Owner only. */
export function canChangeRole(actorRole, targetRole, newRole) {
  return (
    can(actorRole, GroupAction.CHANGE_ROLE) &&
    (targetRole === Role.ADMIN || targetRole === Role.MEMBER) &&
    (newRole === Role.ADMIN || newRole === Role.MEMBER) &&
    newRole !== targetRole
  );
}

/** Hand the group to another current member. Owner only. */
export function canTransferOwnership(actorRole, targetRole) {
  return (
    can(actorRole, GroupAction.TRANSFER_OWNERSHIP) && isRole(targetRole) && targetRole !== Role.OWNER
  );
}
