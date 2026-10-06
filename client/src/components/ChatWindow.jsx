import { ArrowLeft, Info, Loader2 } from 'lucide-react';
import { ConversationType } from '@shared/constants.js';
import { formatLastSeen, formatTyping } from '../lib/format.js';
import { Connection, useChat } from '../store/chat.js';
import Avatar from './Avatar.jsx';
import Composer from './Composer.jsx';
import MessageList from './MessageList.jsx';
import { titleOf } from './Sidebar.jsx';

/** Shown whenever the socket has dropped; disappears once missed messages are synced. */
function ConnectionBanner() {
  const connection = useChat((state) => state.connection);
  if (connection !== Connection.RECONNECTING) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      Reconnecting…
    </div>
  );
}

export default function ChatWindow({ conversation, onBack, onToggleInfo }) {
  const isGroup = conversation.type === ConversationType.GROUP;
  const peerId = conversation.peer?.id;
  const typing = useChat((state) => state.typing[conversation.id]);
  const peerPresence = useChat((state) => (peerId ? state.presence[peerId] : undefined));

  const typingText = formatTyping(Object.values(typing ?? {}));
  let status;
  if (typingText) status = typingText;
  else if (isGroup) status = `${conversation.memberCount} ${conversation.memberCount === 1 ? 'member' : 'members'}`;
  else if (peerPresence?.online) status = 'Online';
  else status = formatLastSeen(peerPresence?.lastSeenAt);

  return (
    <>
      <header className="flex items-center gap-2 border-b border-slate-200 px-2 py-2.5 dark:border-slate-800 sm:px-4">
        <button type="button" className="icon-btn md:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onToggleInfo}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
        >
          <Avatar
            id={isGroup ? conversation.id : peerId}
            name={titleOf(conversation)}
            src={isGroup ? conversation.avatarUrl : conversation.peer?.avatarUrl}
            group={isGroup}
            online={isGroup ? undefined : Boolean(peerPresence?.online)}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{titleOf(conversation)}</span>
            <span
              className={`block truncate text-xs ${
                typingText || (!isGroup && peerPresence?.online)
                  ? 'text-brand-600 dark:text-brand-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {status}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleInfo}
          aria-label={isGroup ? 'Group info' : 'Contact info'}
          title={isGroup ? 'Group info' : 'Contact info'}
        >
          <Info className="h-5 w-5" />
        </button>
      </header>

      <ConnectionBanner />
      <MessageList conversation={conversation} />
      <Composer conversationId={conversation.id} />
    </>
  );
}
