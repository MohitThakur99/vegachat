import { useEffect, useRef, useState } from 'react';
import { Crown, Loader2, LogOut, MoreVertical, Pencil, Shield, Trash2, UserPlus, X } from 'lucide-react';
import { ConversationType, Limits, Role } from '@shared/constants.js';
import {
  GroupAction,
  can,
  canChangeRole,
  canRemoveMember,
  canTransferOwnership,
} from '@shared/permissions.js';
import { formatLastSeen } from '../lib/format.js';
import { useChat } from '../store/chat.js';
import { toastError } from '../store/ui.js';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';
import UserPicker from './UserPicker.jsx';

const ROLE_BADGES = {
  [Role.OWNER]: {
    label: 'Owner',
    Icon: Crown,
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  [Role.ADMIN]: {
    label: 'Admin',
    Icon: Shield,
    className: 'bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-300',
  },
};

function RoleBadge({ role }) {
  const badge = ROLE_BADGES[role];
  if (!badge) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>
      <badge.Icon className="h-3 w-3" />
      {badge.label}
    </span>
  );
}

/** Name and picture editor, shown to admins and the owner. */
function EditGroupForm({ conversation, onDone }) {
  const [name, setName] = useState(conversation.name);
  const [avatarUrl, setAvatarUrl] = useState(conversation.avatarUrl ?? '');
  const [saving, setSaving] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await useChat.getState().updateGroup(conversation.id, {
        name: name.trim(),
        avatarUrl: avatarUrl.trim() || null,
      });
      onDone();
    } catch (err) {
      toastError(err);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full space-y-3 text-left">
      <div>
        <label htmlFor="edit-group-name" className="label">
          Group name
        </label>
        <input
          id="edit-group-name"
          className="input"
          required
          autoFocus
          maxLength={Limits.GROUP_NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="edit-group-avatar" className="label">
          Picture URL
        </label>
        <input
          id="edit-group-avatar"
          type="url"
          className="input"
          placeholder="https://…"
          maxLength={Limits.AVATAR_URL_MAX}
          value={avatarUrl}
          onChange={(event) => setAvatarUrl(event.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={saving || !name.trim()}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </button>
      </div>
    </form>
  );
}

function AddMembersModal({ conversationId, memberIds, onClose }) {
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);

  const toggle = (user) =>
    setPicked((current) =>
      current.some((u) => u.id === user.id) ? current.filter((u) => u.id !== user.id) : [...current, user],
    );

  async function add() {
    setSaving(true);
    try {
      await useChat.getState().addMembers(
        conversationId,
        picked.map((user) => user.id),
      );
      onClose();
    } catch (err) {
      toastError(err);
      setSaving(false);
    }
  }

  return (
    <Modal title="Add members" onClose={onClose}>
      <UserPicker onPick={toggle} selectedIds={picked.map((user) => user.id)} excludeIds={memberIds} />
      <button type="button" className="btn-primary mt-4 w-full" disabled={saving || picked.length === 0} onClick={add}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {picked.length > 0 ? `Add ${picked.length} ${picked.length === 1 ? 'person' : 'people'}` : 'Add'}
      </button>
    </Modal>
  );
}

/**
 * One member with the actions the viewer is allowed to take on them. The
 * same rule functions run on the server; here they only decide what to show.
 */
function MemberRow({ member, conversation, isMe, online, menuOpen, onToggleMenu, run }) {
  const { id: conversationId, role: myRole } = conversation;
  const store = useChat.getState();
  const firstName = member.displayName.split(' ')[0];

  const actions = [];
  if (!isMe) {
    if (canChangeRole(myRole, member.role, Role.ADMIN)) {
      actions.push({
        label: 'Make admin',
        onClick: () => run(() => store.changeRole(conversationId, member.id, Role.ADMIN)),
      });
    }
    if (canChangeRole(myRole, member.role, Role.MEMBER)) {
      actions.push({
        label: 'Dismiss as admin',
        onClick: () => run(() => store.changeRole(conversationId, member.id, Role.MEMBER)),
      });
    }
    if (canTransferOwnership(myRole, member.role)) {
      actions.push({
        label: 'Transfer ownership',
        onClick: () =>
          run(
            () => store.transferOwnership(conversationId, member.id),
            `Make ${firstName} the owner of this group? You will become an admin.`,
          ),
      });
    }
    if (canRemoveMember(myRole, member.role)) {
      actions.push({
        label: 'Remove from group',
        danger: true,
        onClick: () =>
          run(() => store.removeMember(conversationId, member.id), `Remove ${firstName} from this group?`),
      });
    }
  }

  return (
    <li className="relative flex items-center gap-3 px-4 py-2">
      <Avatar id={member.id} name={member.displayName} src={member.avatarUrl} online={online} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">
            {member.displayName}
            {isMe && <span className="font-normal text-slate-500"> (you)</span>}
          </span>
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {online ? 'Online' : formatLastSeen(member.lastSeenAt)}
        </p>
      </div>
      <RoleBadge role={member.role} />

      {actions.length > 0 && (
        <>
          <button
            type="button"
            className="icon-btn h-8 w-8"
            onClick={() => onToggleMenu(member.id)}
            aria-label={`Actions for ${member.displayName}`}
            aria-expanded={menuOpen}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <ul
              role="menu"
              className="absolute right-4 top-11 z-20 w-48 animate-fade-in overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
            >
              {actions.map((action) => (
                <li key={action.label}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={action.onClick}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 ${
                      action.danger ? 'text-red-600 dark:text-red-400' : ''
                    }`}
                  >
                    {action.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

export default function InfoPanel({ conversation, onClose }) {
  const me = useChat((state) => state.me);
  const members = useChat((state) => state.members[conversation.id]);
  const presence = useChat((state) => state.presence);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const panelRef = useRef(null);

  // A click outside an open member menu, or Escape, closes it.
  useEffect(() => {
    if (!menuFor) return undefined;
    const onMouseDown = (event) => {
      if (!event.target.closest('[role="menu"], [aria-expanded="true"]')) setMenuFor(null);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuFor(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuFor]);

  const isGroup = conversation.type === ConversationType.GROUP;
  const myRole = conversation.role;
  const peer = conversation.peer;
  const peerPresence = peer ? presence[peer.id] : null;

  /** Runs a group action; asks first when `confirmText` is given. */
  async function run(action, confirmText) {
    setMenuFor(null);
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await action();
    } catch (err) {
      toastError(err);
    }
  }

  const store = useChat.getState();

  return (
    <aside
      ref={panelRef}
      aria-label={isGroup ? 'Group info' : 'Contact info'}
      className="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:w-96 xl:static xl:z-auto xl:w-80 xl:shrink-0 xl:shadow-none"
    >
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="flex-1 text-sm font-semibold">{isGroup ? 'Group info' : 'Contact info'}</h2>
        <button type="button" className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex flex-col items-center gap-2 px-6 py-6 text-center">
          {isGroup ? (
            <>
              <Avatar id={conversation.id} name={conversation.name} src={conversation.avatarUrl} group size="xl" />
              {editing ? (
                <EditGroupForm conversation={conversation} onDone={() => setEditing(false)} />
              ) : (
                <>
                  <h3 className="flex max-w-full items-center gap-1 text-lg font-semibold">
                    <span className="truncate">{conversation.name}</span>
                    {can(myRole, GroupAction.UPDATE_GROUP) && (
                      <button
                        type="button"
                        className="icon-btn h-8 w-8"
                        onClick={() => setEditing(true)}
                        aria-label="Edit group name and picture"
                        title="Edit group"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Group · {conversation.memberCount} {conversation.memberCount === 1 ? 'member' : 'members'}
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <Avatar id={peer?.id} name={peer?.displayName} src={peer?.avatarUrl} size="xl" />
              <h3 className="max-w-full truncate text-lg font-semibold">{peer?.displayName}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {peerPresence?.online ? 'Online' : formatLastSeen(peerPresence?.lastSeenAt)}
              </p>
            </>
          )}
        </section>

        {isGroup && (
          <section className="border-t border-slate-200 py-3 dark:border-slate-800">
            <div className="flex items-center justify-between px-4 pb-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Members
              </h4>
              {can(myRole, GroupAction.ADD_MEMBER) && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/50"
                  onClick={() => setAdding(true)}
                >
                  <UserPlus className="h-4 w-4" />
                  Add
                </button>
              )}
            </div>

            {members ? (
              <ul>
                {members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    conversation={conversation}
                    isMe={member.id === me.id}
                    online={member.id === me.id ? true : Boolean(presence[member.id]?.online)}
                    menuOpen={menuFor === member.id}
                    onToggleMenu={(id) => setMenuFor((current) => (current === id ? null : id))}
                    run={run}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex justify-center py-6" role="status">
                <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-label="Loading members" />
              </div>
            )}
          </section>
        )}

        {isGroup && (
          <section className="space-y-1 border-t border-slate-200 p-3 dark:border-slate-800">
            {can(myRole, GroupAction.LEAVE_GROUP) && (
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                onClick={() => run(() => store.removeMember(conversation.id, me.id), 'Leave this group?')}
              >
                <LogOut className="h-4 w-4" />
                Leave group
              </button>
            )}
            {can(myRole, GroupAction.DELETE_GROUP) && (
              <>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  onClick={() =>
                    run(
                      () => store.deleteGroup(conversation.id),
                      `Delete “${conversation.name}” and all of its messages for everyone? This cannot be undone.`,
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  Delete group
                </button>
                <p className="px-3 text-xs text-slate-500 dark:text-slate-400">
                  As the owner you cannot leave. Transfer ownership to another member first, or delete the group.
                </p>
              </>
            )}
          </section>
        )}
      </div>

      {adding && members && (
        <AddMembersModal
          conversationId={conversation.id}
          memberIds={members.map((member) => member.id)}
          onClose={() => setAdding(false)}
        />
      )}
    </aside>
  );
}
