import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ConversationType, MessageType } from '@shared/constants.js';
import { formatDay, isSameDay } from '../lib/format.js';
import { Receipt } from '../lib/receipt.js';
import { useChat } from '../store/chat.js';
import MessageBubble from './MessageBubble.jsx';

const NO_ITEMS = [];
const NO_MEMBERS = [];

/** How close to an edge (px) counts as "at the top" / "at the bottom". */
const LOAD_MORE_THRESHOLD = 200;
const STICK_THRESHOLD = 80;
/** Consecutive messages from one person within this window share a header. */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

export default function MessageList({ conversation }) {
  const conversationId = conversation.id;
  const me = useChat((state) => state.me);
  const thread = useChat((state) => state.threads[conversationId]);
  const members = useChat((state) => state.members[conversationId]) ?? NO_MEMBERS;

  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  /** Follow new messages only while the reader is at the bottom. */
  const stickToBottom = useRef(true);
  /** scrollHeight just before older messages were requested. */
  const heightBeforePrepend = useRef(null);
  const [menuFor, setMenuFor] = useState(null);

  const items = thread?.items ?? NO_ITEMS;
  const loaded = Boolean(thread?.loaded);
  const loading = Boolean(thread?.loading);
  const hasMore = thread?.hasMore ?? true;
  const firstId = items[0]?.id;
  const last = items.at(-1);

  const loadOlder = useCallback(() => {
    const current = useChat.getState().threads[conversationId];
    const element = scrollRef.current;
    if (!element || !current?.loaded || current.loading || !current.hasMore) return;
    heightBeforePrepend.current = element.scrollHeight;
    useChat.getState().loadOlder(conversationId);
  }, [conversationId]);

  // Older messages were added above: keep what the reader was looking at in
  // place by scrolling down by exactly the height that was added.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && heightBeforePrepend.current != null) {
      element.scrollTop += element.scrollHeight - heightBeforePrepend.current;
      heightBeforePrepend.current = null;
    }
  }, [firstId]);

  useEffect(() => {
    if (!loading) heightBeforePrepend.current = null;
  }, [loading]);

  // A new message at the bottom: follow it if the reader was already there, or
  // if they just sent it themselves.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && (stickToBottom.current || last?.localStatus)) {
      element.scrollTop = element.scrollHeight;
      stickToBottom.current = true;
    }
  }, [last?.id, last?.localStatus, loaded]);

  // Images finish loading after layout and change the height; stay pinned.
  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
    // The scroll container only exists once the first page has loaded.
  }, [loaded]);

  // If the first page does not fill the viewport there is nothing to scroll,
  // so fetch more until it does.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && loaded && !loading && hasMore && element.scrollHeight <= element.clientHeight + LOAD_MORE_THRESHOLD) {
      loadOlder();
    }
  }, [items.length, loaded, loading, hasMore, loadOlder]);

  const onScroll = () => {
    const element = scrollRef.current;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD;
    if (element.scrollTop < LOAD_MORE_THRESHOLD) loadOlder();
  };

  const isGroup = conversation.type === ConversationType.GROUP;
  const others = useMemo(() => members.filter((member) => member.id !== me.id), [members, me.id]);
  const peer = conversation.peer;

  // Only the newest of my messages spells out "Seen by X of Y"; older ones show ticks.
  const lastOwnId = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.senderId === me.id && item.type === MessageType.TEXT && item.seq != null && !item.deletedAt) {
        return item.id;
      }
    }
    return null;
  }, [items, me.id]);

  const toggleMenu = useCallback((id) => setMenuFor((current) => (current === id ? null : id)), []);

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-label="Loading messages" />
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 bg-slate-50 dark:bg-slate-950">
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
          <span className="rounded-full bg-white p-1.5 shadow dark:bg-slate-800">
            <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-label="Loading older messages" />
          </span>
        </div>
      )}

      {/* Native scroll anchoring is off: the layout effect above does it, and both together would double-correct. */}
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto [overflow-anchor:none]">
        <div ref={contentRef} className="flex min-h-full flex-col justify-end py-3">
          {!hasMore && items.length > 0 && (
            <p className="py-3 text-center text-xs text-slate-400">Beginning of the conversation</p>
          )}
          {items.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              No messages yet. Say hello!
            </p>
          )}

          {items.map((message, index) => {
            const previous = items[index - 1];
            const own = message.senderId === me.id;
            const newDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
            const grouped =
              !newDay &&
              previous.type === MessageType.TEXT &&
              previous.senderId === message.senderId &&
              new Date(message.createdAt) - new Date(previous.createdAt) < GROUPING_WINDOW_MS;

            let receipt = null;
            let seenBy = 0;
            if (own && message.seq != null && !message.deletedAt) {
              if (isGroup) {
                seenBy = others.filter((member) => member.lastReadSeq >= message.seq).length;
                receipt = others.length > 0 && seenBy === others.length ? Receipt.READ : Receipt.SENT;
              } else if (peer) {
                if (peer.lastReadSeq >= message.seq) receipt = Receipt.READ;
                else if (peer.lastDeliveredSeq >= message.seq) receipt = Receipt.DELIVERED;
                else receipt = Receipt.SENT;
              }
            }

            return (
              <div key={message.id}>
                {newDay && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-400">
                      {formatDay(message.createdAt)}
                    </span>
                  </div>
                )}
                <MessageBubble
                  message={message}
                  own={own}
                  isGroup={isGroup}
                  grouped={grouped}
                  receipt={receipt}
                  seenBy={seenBy}
                  seenTotal={others.length}
                  showSeenBy={isGroup && message.id === lastOwnId}
                  menuOpen={menuFor === message.id}
                  onToggleMenu={toggleMenu}
                  myId={me.id}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
