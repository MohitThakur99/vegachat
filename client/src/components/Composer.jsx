import { useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, SendHorizontal, X } from 'lucide-react';
import { ALLOWED_UPLOAD_MIME_TYPES, Limits } from '@shared/constants.js';
import { ClientEvent } from '@shared/events.js';
import { api } from '../lib/api.js';
import { formatFileSize } from '../lib/format.js';
import { signal } from '../lib/socket.js';
import { useChat } from '../store/chat.js';

/** Stop announcing "typing" this long after the last keystroke. */
const TYPING_IDLE_MS = 3000;
const MAX_HEIGHT_PX = 160;

/** Same checks as the server, done first so the user gets an instant answer. */
function validateFile(file) {
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type)) {
    return 'Only PNG, JPEG, GIF, WebP, PDF and plain-text files can be shared.';
  }
  if (file.size > Limits.UPLOAD_MAX_BYTES) {
    return `Files can be at most ${formatFileSize(Limits.UPLOAD_MAX_BYTES)}.`;
  }
  if (file.size === 0) return 'That file is empty.';
  return null;
}

export default function Composer({ conversationId }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastTypingAt = useRef(0);
  const idleTimer = useRef(null);

  function stopTyping() {
    clearTimeout(idleTimer.current);
    if (lastTypingAt.current === 0) return;
    lastTypingAt.current = 0;
    signal(ClientEvent.TYPING_STOP, { conversationId });
  }

  /**
   * Throttled: however fast the user types, at most one `typing:start` goes
   * out per TYPING_THROTTLE_MS, followed by one `typing:stop` when they pause.
   */
  function announceTyping() {
    const now = Date.now();
    if (now - lastTypingAt.current >= Limits.TYPING_THROTTLE_MS) {
      lastTypingAt.current = now;
      signal(ClientEvent.TYPING_START, { conversationId });
    }
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  // Leaving the conversation ends "typing" for the others.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => stopTyping, []);

  // Grow with the content up to a limit, then scroll.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  function onPickFile(event) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    const problem = validateFile(picked);
    setError(problem);
    setFile(problem ? null : picked);
  }

  async function submit() {
    const body = text.trim();
    if ((!body && !file) || uploading) return;
    if (body.length > Limits.MESSAGE_MAX_LENGTH) {
      setError(`Messages can be at most ${Limits.MESSAGE_MAX_LENGTH} characters.`);
      return;
    }
    setError(null);

    let attachment = null;
    if (file) {
      // The file goes up over REST first; the message then refers to it by id.
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        ({ attachment } = await api(`/api/conversations/${conversationId}/attachments`, {
          method: 'POST',
          formData,
        }));
      } catch (err) {
        setError(err.message);
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    useChat.getState().sendMessage(conversationId, body, attachment);
    setText('');
    setFile(null);
    stopTyping();
    textareaRef.current?.focus();
  }

  const canSend = (text.trim().length > 0 || file) && !uploading;

  return (
    <div className="border-t border-slate-200 bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 dark:border-slate-800 dark:bg-slate-900 sm:px-4">
      {error && (
        <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}

      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
          <Paperclip className="h-4 w-4 shrink-0 text-slate-500" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="shrink-0 text-xs text-slate-500">{formatFileSize(file.size)}</span>
          <button
            type="button"
            className="icon-btn h-6 w-6"
            onClick={() => setFile(null)}
            disabled={uploading}
            aria-label="Remove attachment"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <form
        className="flex items-end gap-1 sm:gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept={ALLOWED_UPLOAD_MIME_TYPES.join(',')}
          onChange={onPickFile}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Attach a file"
          title="Attach a file"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value.trim()) announceTyping();
            else stopTyping();
          }}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter adds a line. Not while an IME is composing.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          onBlur={stopTyping}
          placeholder="Type a message"
          aria-label="Message"
          className="max-h-40 min-h-[2.25rem] flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500"
        />

        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
