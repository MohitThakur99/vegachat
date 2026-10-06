import { useMemo, useState } from 'react';
import { LogOut, Paperclip, Search, SquarePen } from 'lucide-react';
import { ConversationType, MessageType } from '@shared/constants.js';
import { formatListTime, formatTyping } from '../lib/format.js';
import { useAuth } from '../store/auth.js';
import { useChat } from '../store/chat.js';
import { ThemeToggle } from './AuthLayout.jsx';
import Avatar from './Avatar.jsx';

/** Display name and avatar of a conversation from the viewer's side. */
export function titleOf(conversation) {
  return conversation.type === ConversationType.DIRECT
    ? (conversation.peer?.displayName ?? 'Unknown user')
    : conversation.name;
}

function previewText(conversation, myId) {
  const message = conversation.lastMessage;
  if (!message) return 'No messages yet';
  if (message.type === MessageType.SYSTEM) return message.body;
  if (message.deletedAt) return 'This message was deleted';

  const text = message.body || (message.hasAttachment ? 'Attachment' : '');
  if (message.senderId === myId) return `You: ${text}`;
  if (conversation.type === ConversationType.GROUP) return `${message.senderName.split(' ')[0]}: ${text}`;
  return text;
}

function ConversationRow({ conversation, active, myId, onSelect }) {
  const typing = useChat((state) => state.typing[conversation.id]);
  const peerOnline = useChat((state) =>
    conversation.peer ? (state.presence[conversation.peer.id]?.online ?? false) : undefined,
  );

  const typingText = formatTyping(Object.values(typing ?? {}));
  const isGroup = conversation.type === ConversationType.GROUP;
  const unread = conversation.unreadCount;
  const showClip = !typingText && conversation.lastMessage?.hasAttachment && !conversation.lastMessage.deletedAt;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        aria-current={active ? 'true' : undefined}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
          active ? 'bg-brand-50 dark:bg-brand-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
        }`}
      >
        <Avatar
          id={isGroup ? conversation.id : conversation.peer?.id}
          name={titleOf(conversation)}
          src={isGroup ? conversation.avatarUrl : conversation.peer?.avatarUrl}
          group={isGroup}
          online={peerOnline}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-sm ${unread > 0 ? 'font-semibold' : 'font-medium'}`}>
              {titleOf(conversation)}
            </span>
            <span
              className={`shrink-0 text-xs ${
                unread > 0 ? 'font-medium text-brand-600 dark:text-brand-400' : 'text-slate-400'
              }`}
            >
              {formatListTime(conversation.lastActivityAt)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span
              className={`flex min-w-0 items-center gap-1 text-sm ${
                typingText
                  ? 'text-brand-600 dark:text-brand-400'
                  : unread > 0
                    ? 'text-slate-700 dark:text-slate-200'
                    : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {showClip && <Paperclip className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{typingText || previewText(conversation, myId)}</span>
            </span>
            {unread > 0 && (
              <span
                className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white"
                aria-label={`${unread} unread`}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

export default function Sidebar({ activeId, onSelect, onNewChat }) {
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);
  const conversations = useChat((state) => state.conversations);
  const listLoaded = useChat((state) => state.listLoaded);
  const [filter, setFilter] = useState('');

  // Latest activity first; re-sorted whenever a message arrives.
  const sorted = useMemo(
    () =>
      Object.values(conversations).sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt)),
    [conversations],
  );
  const term = filter.trim().toLowerCase();
  const visible = term ? sorted.filter((c) => titleOf(c).toLowerCase().includes(term)) : sorted;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <Avatar id={user.id} name={user.displayName} src={user.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{user.displayName}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
        </div>
        <ThemeToggle />
        <button type="button" className="icon-btn" onClick={onNewChat} aria-label="New conversation" title="New conversation">
          <SquarePen className="h-5 w-5" />
        </button>
        <button type="button" className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      <div className="px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter conversations"
            aria-label="Filter conversations"
            className="input pl-9"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversations">
        {!listLoaded ? (
          <ul aria-hidden="true">
            {[0, 1, 2, 3, 4].map((row) => (
              <li key={row} className="flex animate-pulse items-center gap-3 px-4 py-3">
                <span className="h-12 w-12 rounded-full bg-slate-200 dark:bg-slate-800" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
                  <span className="block h-3 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
                </span>
              </li>
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {term ? 'No conversations match.' : 'No conversations yet. Start one with the pencil button.'}
          </p>
        ) : (
          <ul>
            {visible.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeId}
                myId={user.id}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </nav>
    </>
  );
}
