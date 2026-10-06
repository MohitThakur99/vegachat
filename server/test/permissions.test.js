import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Role } from '../../shared/constants.js';
import {
  GroupAction,
  ROLE_PERMISSIONS,
  can,
  canChangeRole,
  canRemoveMember,
  canTransferOwnership,
  outranks,
} from '../../shared/permissions.js';

const { OWNER, ADMIN, MEMBER } = Role;
const ROLES = [OWNER, ADMIN, MEMBER];

describe('can(role, action)', () => {
  // The assignment's permission table, written out in full so that any change
  // to the matrix has to be made here deliberately as well.
  const expected = {
    [GroupAction.READ_MESSAGES]: { [OWNER]: true, [ADMIN]: true, [MEMBER]: true },
    [GroupAction.SEND_MESSAGE]: { [OWNER]: true, [ADMIN]: true, [MEMBER]: true },
    [GroupAction.ADD_MEMBER]: { [OWNER]: true, [ADMIN]: true, [MEMBER]: false },
    [GroupAction.REMOVE_MEMBER]: { [OWNER]: true, [ADMIN]: true, [MEMBER]: false },
    [GroupAction.UPDATE_GROUP]: { [OWNER]: true, [ADMIN]: true, [MEMBER]: false },
    [GroupAction.CHANGE_ROLE]: { [OWNER]: true, [ADMIN]: false, [MEMBER]: false },
    [GroupAction.TRANSFER_OWNERSHIP]: { [OWNER]: true, [ADMIN]: false, [MEMBER]: false },
    [GroupAction.DELETE_GROUP]: { [OWNER]: true, [ADMIN]: false, [MEMBER]: false },
    [GroupAction.LEAVE_GROUP]: { [OWNER]: false, [ADMIN]: true, [MEMBER]: true },
  };

  it('covers every action', () => {
    assert.deepEqual(Object.keys(expected).sort(), Object.values(GroupAction).sort());
  });

  for (const [action, byRole] of Object.entries(expected)) {
    for (const role of ROLES) {
      it(`${role} ${byRole[role] ? 'can' : 'cannot'} ${action}`, () => {
        assert.equal(can(role, action), byRole[role]);
      });
    }
  }

  it('denies everything to an unknown or missing role', () => {
    for (const action of Object.values(GroupAction)) {
      for (const role of ['superuser', '', null, undefined, 'OWNER', '__proto__', 'constructor']) {
        assert.equal(can(role, action), false, `${String(role)} / ${action}`);
      }
    }
  });

  it('denies an unknown action to every role', () => {
    for (const role of ROLES) {
      assert.equal(can(role, 'group:nuke'), false);
      assert.equal(can(role, undefined), false);
    }
  });

  it('never gives a lower role something a higher role lacks, except leaving', () => {
    const without = (role) => ROLE_PERMISSIONS[role].filter((action) => action !== GroupAction.LEAVE_GROUP);
    for (const action of without(MEMBER)) assert.ok(can(ADMIN, action), `admin lacks ${action}`);
    for (const action of without(ADMIN)) assert.ok(can(OWNER, action), `owner lacks ${action}`);
  });
});

describe('outranks', () => {
  it('orders owner > admin > member', () => {
    assert.equal(outranks(OWNER, ADMIN), true);
    assert.equal(outranks(OWNER, MEMBER), true);
    assert.equal(outranks(ADMIN, MEMBER), true);
  });

  it('is false for equal or lower ranks', () => {
    assert.equal(outranks(MEMBER, ADMIN), false);
    assert.equal(outranks(ADMIN, OWNER), false);
    for (const role of ROLES) assert.equal(outranks(role, role), false);
  });

  it('is false when either role is unknown', () => {
    assert.equal(outranks(OWNER, 'ghost'), false);
    assert.equal(outranks('ghost', MEMBER), false);
    assert.equal(outranks(OWNER, undefined), false);
  });
});

describe('canRemoveMember', () => {
  it('lets the owner remove admins and members', () => {
    assert.equal(canRemoveMember(OWNER, ADMIN), true);
    assert.equal(canRemoveMember(OWNER, MEMBER), true);
  });

  it('lets an admin remove members only', () => {
    assert.equal(canRemoveMember(ADMIN, MEMBER), true);
    assert.equal(canRemoveMember(ADMIN, ADMIN), false);
    assert.equal(canRemoveMember(ADMIN, OWNER), false);
  });

  it('never lets a member remove anyone', () => {
    for (const target of ROLES) assert.equal(canRemoveMember(MEMBER, target), false);
  });

  it('never lets anyone remove the owner', () => {
    for (const actor of ROLES) assert.equal(canRemoveMember(actor, OWNER), false);
  });

  it('rejects a target who is not in the group', () => {
    assert.equal(canRemoveMember(OWNER, null), false);
    assert.equal(canRemoveMember(ADMIN, undefined), false);
  });
});

describe('canChangeRole', () => {
  it('lets the owner promote a member and demote an admin', () => {
    assert.equal(canChangeRole(OWNER, MEMBER, ADMIN), true);
    assert.equal(canChangeRole(OWNER, ADMIN, MEMBER), true);
  });

  it('rejects admins and members as actors', () => {
    for (const actor of [ADMIN, MEMBER]) {
      assert.equal(canChangeRole(actor, MEMBER, ADMIN), false);
      assert.equal(canChangeRole(actor, ADMIN, MEMBER), false);
    }
  });

  it('cannot create a second owner or demote the owner', () => {
    assert.equal(canChangeRole(OWNER, MEMBER, OWNER), false);
    assert.equal(canChangeRole(OWNER, ADMIN, OWNER), false);
    assert.equal(canChangeRole(OWNER, OWNER, ADMIN), false);
    assert.equal(canChangeRole(OWNER, OWNER, MEMBER), false);
  });

  it('rejects a change to the role the target already has', () => {
    assert.equal(canChangeRole(OWNER, ADMIN, ADMIN), false);
    assert.equal(canChangeRole(OWNER, MEMBER, MEMBER), false);
  });

  it('rejects unknown roles', () => {
    assert.equal(canChangeRole(OWNER, MEMBER, 'moderator'), false);
    assert.equal(canChangeRole(OWNER, null, ADMIN), false);
  });
});

describe('canTransferOwnership', () => {
  it('lets the owner hand over to an admin or a member', () => {
    assert.equal(canTransferOwnership(OWNER, ADMIN), true);
    assert.equal(canTransferOwnership(OWNER, MEMBER), true);
  });

  it('rejects everyone but the owner', () => {
    for (const actor of [ADMIN, MEMBER]) {
      for (const target of ROLES) assert.equal(canTransferOwnership(actor, target), false);
    }
  });

  it('rejects transferring to the owner or to a non-member', () => {
    assert.equal(canTransferOwnership(OWNER, OWNER), false);
    assert.equal(canTransferOwnership(OWNER, null), false);
    assert.equal(canTransferOwnership(OWNER, 'ghost'), false);
  });
});
