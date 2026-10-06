import { memo, useState } from 'react';
import { AlertCircle, Ban, Check, CheckCheck, Clock, Pencil, Smile, Trash2 } from 'lucide-react';
import { Limits, MessageType, REACTION_EMOJIS } from '@shared/constants.js';
import { formatTime } from '../lib/format.js';
import { LocalStatus, useChat } from '../store/chat.js';
import { toastError } from '../store/ui.js';
import AttachmentView from './AttachmentView.jsx';
import Avatar from './Avatar.jsx';
import { Receipt } from '../lib/receipt.js';

function DeliveryIcon({ message, receipt }) {
  if (message.localStatus === LocalStatus.FAILED) {
    return <AlertCircle className="h-3.5 w-3.5 text-red-200" aria-label="Not sent" />;
  }
  if (message.localStatus) return <Clock className="h-3.5 w-3.5 opacity-70" aria-label="Sending" />;
  if (receipt === Receipt.READ) return <CheckCheck className="h-3.5 w-3.5 text-sky-300" aria-label="Read" />;
  if (receipt === Receipt.DELIVERED) return <CheckCheck className="h-3.5 w-3.5 opacity-70" aria-label="Delivered" />;
  if (receipt === Receipt.SENT) return <Check className="h-3.5 w-3.5 opacity-70" aria-label="Sent" />;
  return null;
}

function EditForm({ message, onDone }) {
  const [body, setBody] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const trimmed = body.trim();

  async function save() {
    if (!trimmed || trimmed === message.body) return onDone();
    setSaving(true);
    try {
      await useChat.getState().editMessage(message, trimmed);
      onDone();
    } catch (err) {
      toastError(err);
      setSaving(false);
    }
  }

  return (
    <div className="w-64 max-w-full sm:w-80">
      <textarea
        autoFocus
        rows={3}
        value={body}
        maxLength={Limits.MESSAGE_MAX_LENGTH}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            save();
          }
        }}
        className="w-full resize-none rounded-lg border-0 bg-white/15 p-2 text-sm text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-white/60"
        aria-label="Edit message"
      />
      <div className="mt-1 flex justify-end gap-2 text-xs font-medium">
        <button type="button" onClick={onDone} className="rounded px-2 py-1 hover:bg-white/15">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !trimmed}
          className="rounded bg-white px-2 py-1 text-brand-700 disabled:opacity-60"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  own,
  isGroup,
  grouped,
  receipt,
  seenBy,
  seenTotal,
  showSeenBy,
  menuOpen,
  onToggleMenu,
  myId,
}) {
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (message.type === MessageType.SYSTEM) {
    return (
      <div className="my-2 flex justify-center px-4">
        <span className="max-w-[85%] rounded-lg bg-slate-200/70 px-3 py-1 text-center text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {message.body}
        </span>
      </div>
    );
  }

  const deleted = Boolean(message.deletedAt);
  const pending = Boolean(message.localStatus);
  const failed = message.localStatus === LocalStatus.FAILED;
  const actionable = !deleted && !pending;
  const canEdit = own && actionable && message.body.length > 0;
  // The server enforces the window; this only decides whether to offer the button.
  const canDelete = own && actionable && Date.now() - new Date(message.createdAt) < Limits.DELETE_WINDOW_MS;

  const react = (emoji) => {
    setPickerOpen(false);
    useChat.getState().toggleReaction(message, emoji).catch(toastError);
  };

  const remove = () => {
    if (window.confirm('Delete this message for everyone?')) {
      useChat.getState().deleteMessage(message).catch(toastError);
    }
  };

  const toolbarVisible = menuOpen || pickerOpen;

  return (
    <div
      className={`group flex items-end gap-2 px-3 sm:px-4 ${own ? 'flex-row-reverse' : ''} ${grouped ? 'mt-0.5' : 'mt-3'}`}
    >
      {isGroup && !own && (
        <div className="w-8 shrink-0">
          {!grouped && (
            <Avatar id={message.senderId} name={message.sender.displayName} src={message.sender.avatarUrl} size="sm" />
          )}
        </div>
      )}

      <div className={`flex min-w-0 max-w-[85%] flex-col sm:max-w-[70%] ${own ? 'items-end' : 'items-start'}`}>
        {isGroup && !own && !grouped && (
          <span className="mb-0.5 px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            {message.sender.displayName}
          </span>
        )}

        <div className={`flex max-w-full items-center gap-1 ${own ? 'flex-row-reverse' : ''}`}>
          <div
            // Touch screens have no hover: tapping a bubble shows its actions.
            onClick={() => actionable && !editing && onToggleMenu(message.id)}
            className={`min-w-0 rounded-2xl px-3 py-2 text-sm shadow-sm ${
              own
                ? `bg-brand-600 text-white ${failed ? 'opacity-70' : ''}`
                : 'bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100'
            }`}
          >
            {deleted ? (
              <span className="flex items-center gap-1.5 italic opacity-70">
                <Ban className="h-3.5 w-3.5" />
                This message was deleted
              </span>
            ) : editing ? (
              <EditForm message={message} onDone={() => setEditing(false)} />
            ) : (
              <>
                {message.attachment && <AttachmentView attachment={message.attachment} own={own} />}
                {message.body && (
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.body}</p>
                )}
              </>
            )}

            {!editing && (
              <span
                className={`mt-1 flex items-center justify-end gap-1 text-[11px] leading-none ${
                  own ? 'text-white/80' : 'text-slate-400'
                }`}
              >
                {message.editedAt && !deleted && <span>edited</span>}
                <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                {own && !deleted && <DeliveryIcon message={message} receipt={receipt} />}
              </span>
            )}
          </div>

          {actionable && !editing && (
            <div
              className={`relative flex shrink-0 items-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 group-hover:visible dark:bg-slate-800 dark:ring-slate-700 ${
                toolbarVisible ? 'visible' : 'invisible'
              }`}
            >
              <button
                type="button"
                className="icon-btn h-7 w-7"
                onClick={() => setPickerOpen((open) => !open)}
                aria-label="React"
                aria-expanded={pickerOpen}
              >
                <Smile className="h-4 w-4" />
              </button>
              {canEdit && (
                <button type="button" className="icon-btn h-7 w-7" onClick={() => setEditing(true)} aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="icon-btn h-7 w-7 hover:text-red-600 dark:hover:text-red-400"
                  onClick={remove}
                  aria-label="Delete for everyone"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}

              {pickerOpen && (
                <div
                  className={`absolute bottom-full z-20 mb-1 flex animate-fade-in gap-0.5 rounded-full bg-white p-1 shadow-lg ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700 ${
                    own ? 'right-0' : 'left-0'
                  }`}
                >
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => react(emoji)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition hover:scale-125 hover:bg-slate-100 dark:hover:bg-slate-700"
                      aria-label={`React with ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {message.reactions.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${own ? 'justify-end' : ''}`}>
            {message.reactions.map((reaction) => {
              const mine = reaction.userIds.includes(myId);
              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  onClick={() => react(reaction.emoji)}
                  aria-pressed={mine}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                    mine
                      ? 'border-brand-300 bg-brand-100 text-brand-800 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  <span>{reaction.emoji}</span>
                  <span className="font-medium">{reaction.userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {showSeenBy && seenTotal > 0 && (
          <span className="mt-1 px-1 text-[11px] text-slate-500 dark:text-slate-400">
            Seen by {seenBy} of {seenTotal}
          </span>
        )}

        {failed && (
          <span className="mt-1 flex items-center gap-2 px-1 text-xs text-red-600 dark:text-red-400">
            {message.error ?? 'Not sent'}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => useChat.getState().retryMessage(message.conversationId, message.id)}
            >
              Retry
            </button>
            <button
              type="button"
              className="underline"
              onClick={() => useChat.getState().discardMessage(message.conversationId, message.id)}
            >
              Discard
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export default memo(MessageBubble);
