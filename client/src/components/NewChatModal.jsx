import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Limits } from '@shared/constants.js';
import { useChat } from '../store/chat.js';
import { toastError } from '../store/ui.js';
import Modal from './Modal.jsx';
import UserPicker from './UserPicker.jsx';

const Tab = Object.freeze({ DIRECT: 'direct', GROUP: 'group' });

/** Start a direct chat or create a group. Calls `onOpened(conversationId)` when done. */
export default function NewChatModal({ onClose, onOpened }) {
  const [tab, setTab] = useState(Tab.DIRECT);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true);
    try {
      onOpened(await action());
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  }

  // Opens the existing conversation with this person if there is one.
  const startDirect = (user) => run(() => useChat.getState().openDirect(user.id));

  const createGroup = () =>
    run(() =>
      useChat.getState().createGroup(
        name.trim(),
        picked.map((user) => user.id),
      ),
    );

  const togglePicked = (user) =>
    setPicked((current) =>
      current.some((u) => u.id === user.id) ? current.filter((u) => u.id !== user.id) : [...current, user],
    );

  return (
    <Modal title="New conversation" onClose={onClose}>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
        {[
          [Tab.DIRECT, 'Direct message'],
          [Tab.GROUP, 'New group'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === value
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === Tab.DIRECT ? (
        <UserPicker onPick={startDirect} />
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="group-name" className="label">
              Group name
            </label>
            <input
              id="group-name"
              className="input"
              value={name}
              maxLength={Limits.GROUP_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Weekend plans"
            />
          </div>

          <div>
            <p className="label">Members</p>
            {picked.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-1.5">
                {picked.map((user) => (
                  <li
                    key={user.id}
                    className="flex items-center gap-1 rounded-full bg-brand-100 py-1 pl-3 pr-1 text-xs font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                  >
                    {user.displayName}
                    <button
                      type="button"
                      onClick={() => togglePicked(user)}
                      className="rounded-full p-0.5 hover:bg-brand-200 dark:hover:bg-brand-900"
                      aria-label={`Remove ${user.displayName}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <UserPicker onPick={togglePicked} selectedIds={picked.map((user) => user.id)} />
          </div>

          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy || name.trim().length === 0}
            onClick={createGroup}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create group
          </button>
        </div>
      )}
    </Modal>
  );
}
