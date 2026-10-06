import { create } from 'zustand';
import {
  ConversationType,
  ErrorCode,
  Limits,
  MessageType,
  ReactionAction,
  RemovalReason,
} from '@shared/constants.js';
import { ClientEvent, ServerEvent } from '@shared/events.js';
import { api } from '../lib/api.js';
import { uuid } from '../lib/format.js';
import { SocketFailure, connectSocket, disconnectSocket, isSocketReady, request } from '../lib/socket.js';
import { toast } from './ui.js';

export const Connection = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
});

/** Lifecycle of a message this client is still trying to deliver. */
export const LocalStatus = Object.freeze({
  SENDING: 'sending',
  /** Waiting for the connection to come back. */
  QUEUED: 'queued',
  FAILED: 'failed',
});

const MAX_SEND_ATTEMPTS = 4;
const PREVIEW_LENGTH = 140;

const EMPTY_THREAD = Object.freeze({ items: [], hasMore: true, loading: false, loaded: false });

const initialState = {
  /** The signed-in user. */
  me: null,
  connection: Connection.IDLE,
  /** conversationId -> Conversation (see shared/events.js). */
  conversations: {},
  listLoaded: false,
  /** conversationId -> Member[], loaded when a conversation is opened. */
  members: {},
  /** conversationId -> { items: Message[], hasMore, loading, loaded }. */
  threads: {},
  /** conversationId -> { [userId]: displayName } for people typing right now. */
  typing: {},
  /** userId -> { online, lastSeenAt }. */
  presence: {},
  activeId: null,
};

/** Whether the person is actually looking at this tab. */
const isViewing = () => document.visibilityState === 'visible' && document.hasFocus();

// Messages still being sent have no seq yet and sort after everything else.
const bySeq = (a, b) =>
  (a.seq ?? Infinity) - (b.seq ?? Infinity) || new Date(a.createdAt) - new Date(b.createdAt);

function upsertMessage(items, message) {
  const index = items.findIndex((item) => item.id === message.id);
  const next = index === -1 ? [...items, message] : items.map((item, i) => (i === index ? message : item));
  return next.sort(bySeq);
}

const previewOf = (message) => ({
  id: message.id,
  seq: message.seq,
  senderId: message.senderId,
  senderName: message.sender?.displayName ?? '',
  type: message.type,
  body: message.body.slice(0, PREVIEW_LENGTH),
  hasAttachment: Boolean(message.attachment),
  createdAt: message.createdAt,
  deletedAt: message.deletedAt,
});

/** Applies one add/remove to a message's reactions. Safe to apply twice. */
function applyReaction(reactions, { userId, emoji, action }) {
  const without = reactions
    .map((reaction) =>
      reaction.emoji === emoji
        ? { ...reaction, userIds: reaction.userIds.filter((id) => id !== userId) }
        : reaction,
    )
    .filter((reaction) => reaction.userIds.length > 0);
  if (action === ReactionAction.REMOVE) return without;

  const existing = without.find((reaction) => reaction.emoji === emoji);
  if (!existing) return [...without, { emoji, userIds: [userId] }];
  return without.map((reaction) =>
    reaction === existing ? { ...reaction, userIds: [...reaction.userIds, userId] } : reaction,
  );
}

const presenceOf = (person) => ({ online: person.online, lastSeenAt: person.lastSeenAt });

/** Timers that hide "X is typing…" when the stop event never arrives. */
const typingTimers = new Map();

export const useChat = create((set, get) => {
  /* ------------------------------------------------------------------ */
  /* State helpers                                                      */
  /* ------------------------------------------------------------------ */

  const patchConversation = (id, patch) =>
    set((state) => {
      const current = state.conversations[id];
      if (!current) return {};
      const changes = typeof patch === 'function' ? patch(current) : patch;
      return { conversations: { ...state.conversations, [id]: { ...current, ...changes } } };
    });

  const patchThread = (id, update) =>
    set((state) => ({ threads: { ...state.threads, [id]: update(state.threads[id] ?? EMPTY_THREAD) } }));

  const patchMessage = (conversationId, messageId, update) =>
    set((state) => {
      const thread = state.threads[conversationId];
      if (!thread) return {};
      const items = thread.items.map((item) => (item.id === messageId ? update(item) : item));
      return { threads: { ...state.threads, [conversationId]: { ...thread, items } } };
    });

  const patchMembers = (conversationId, update) =>
    set((state) => {
      const current = state.members[conversationId];
      return current ? { members: { ...state.members, [conversationId]: update(current) } } : {};
    });

  const findMessage = (conversationId, messageId) =>
    get().threads[conversationId]?.items.find((item) => item.id === messageId);

  /**
   * Stores a conversation from the server. If a live event has already moved
   * the local copy past this snapshot, the newer local fields win.
   */
  const mergeConversation = (current, incoming) =>
    current && current.lastMessageSeq > incoming.lastMessageSeq
      ? {
          ...incoming,
          lastMessage: current.lastMessage,
          lastMessageSeq: current.lastMessageSeq,
          lastActivityAt: current.lastActivityAt,
          unreadCount: current.unreadCount,
        }
      : incoming;

  const storeConversation = (conversation) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [conversation.id]: mergeConversation(state.conversations[conversation.id], conversation),
      },
      presence: conversation.peer
        ? { ...state.presence, [conversation.peer.id]: presenceOf(conversation.peer) }
        : state.presence,
    }));

  const storeMembers = (conversationId, members) =>
    set((state) => ({
      members: { ...state.members, [conversationId]: members },
      presence: { ...state.presence, ...Object.fromEntries(members.map((m) => [m.id, presenceOf(m)])) },
    }));

  /** Drops everything known about a conversation the user is no longer in. */
  const forgetConversation = (id) =>
    set((state) => {
      const { [id]: _conversation, ...conversations } = state.conversations;
      const { [id]: _members, ...members } = state.members;
      const { [id]: _thread, ...threads } = state.threads;
      const { [id]: _typing, ...typing } = state.typing;
      return { conversations, members, threads, typing };
    });

  const setTyping = (conversationId, userId, displayName) => {
    const key = `${conversationId}:${userId}`;
    clearTimeout(typingTimers.get(key));
    typingTimers.delete(key);

    set((state) => {
      const { [userId]: _removed, ...rest } = state.typing[conversationId] ?? {};
      return {
        typing: { ...state.typing, [conversationId]: displayName ? { ...rest, [userId]: displayName } : rest },
      };
    });

    if (displayName) {
      typingTimers.set(
        key,
        setTimeout(() => setTyping(conversationId, userId, null), Limits.TYPING_TIMEOUT_MS),
      );
    }
  };

  /* ------------------------------------------------------------------ */
  /* Server events                                                      */
  /* ------------------------------------------------------------------ */

  /** A message arrived: from someone else, from another of my tabs, or as my own ack. */
  const receiveMessage = (message) => {
    const { me, activeId } = get();
    const { conversationId } = message;
    const conversation = get().conversations[conversationId];

    if (!conversation) {
      // A conversation this tab has not heard of yet; fetch it with its counts.
      get().loadDetail(conversationId);
      return;
    }

    if (get().threads[conversationId]?.loaded) {
      patchThread(conversationId, (thread) => ({ ...thread, items: upsertMessage(thread.items, message) }));
    }
    setTyping(conversationId, message.senderId, null);

    // Already accounted for (for example it was in a snapshot fetched a moment ago).
    if (message.seq <= conversation.lastMessageSeq) {
      if (conversation.lastMessage?.id === message.id) {
        patchConversation(conversationId, { lastMessage: previewOf(message) });
      }
      return;
    }

    const mine = message.senderId === me.id;
    const reading = activeId === conversationId && isViewing();

    patchConversation(conversationId, (current) => ({
      lastMessage: previewOf(message),
      lastMessageSeq: message.seq,
      lastActivityAt: message.createdAt,
      // My own message means I have read everything before it.
      lastReadSeq: mine ? message.seq : current.lastReadSeq,
      unreadCount: mine ? 0 : current.unreadCount + (reading ? 0 : 1),
    }));

    if (mine) return;
    if (reading) {
      get().markRead(conversationId);
    } else if (conversation.type === ConversationType.DIRECT) {
      // Lets the sender show "delivered". Groups only show "seen by".
      request(ClientEvent.CONVERSATION_DELIVERED, { conversationId, seq: message.seq }).catch(() => {});
    }
  };

  const receiveUpdatedMessage = (message) => {
    patchMessage(message.conversationId, message.id, () => message);
    patchConversation(message.conversationId, (current) =>
      current.lastMessage?.id === message.id ? { lastMessage: previewOf(message) } : {},
    );
  };

  const receiveDeletedMessage = ({ conversationId, messageId, deletedAt }) => {
    const { me } = get();
    const known = findMessage(conversationId, messageId);

    patchMessage(conversationId, messageId, (message) => ({
      ...message,
      body: '',
      attachment: null,
      reactions: [],
      deletedAt,
    }));

    patchConversation(conversationId, (current) => {
      const changes = {};
      if (current.lastMessage?.id === messageId) {
        changes.lastMessage = { ...current.lastMessage, body: '', hasAttachment: false, deletedAt };
      }
      // A deleted message no longer counts as unread.
      const target = known ?? (current.lastMessage?.id === messageId ? current.lastMessage : null);
      if (target && target.senderId !== me.id && target.seq > current.lastReadSeq && current.unreadCount > 0) {
        changes.unreadCount = current.unreadCount - 1;
      }
      return changes;
    });
  };

  const receiveReaction = ({ conversationId, messageId, ...reaction }) =>
    patchMessage(conversationId, messageId, (message) => ({
      ...message,
      reactions: applyReaction(message.reactions, reaction),
    }));

  /** Someone's read / delivered watermark moved: me in another tab, or another member. */
  const receiveReceipt = ({ conversationId, userId, lastReadSeq, lastDeliveredSeq }) => {
    if (userId === get().me.id) {
      patchConversation(conversationId, (current) => ({
        lastReadSeq: Math.max(current.lastReadSeq, lastReadSeq),
        unreadCount: lastReadSeq >= current.lastMessageSeq ? 0 : current.unreadCount,
      }));
      return;
    }
    patchConversation(conversationId, (current) =>
      current.peer?.id === userId ? { peer: { ...current.peer, lastReadSeq, lastDeliveredSeq } } : {},
    );
    patchMembers(conversationId, (members) =>
      members.map((member) => (member.id === userId ? { ...member, lastReadSeq, lastDeliveredSeq } : member)),
    );
  };

  const receivePresence = ({ userId, online, lastSeenAt }) =>
    set((state) => ({
      presence: {
        ...state.presence,
        [userId]: { online, lastSeenAt: lastSeenAt ?? state.presence[userId]?.lastSeenAt ?? null },
      },
    }));

  const receiveRemoval = ({ conversationId, reason }) => {
    const conversation = get().conversations[conversationId];
    if (!conversation) return;
    forgetConversation(conversationId);
    if (reason === RemovalReason.REMOVED) toast(`You were removed from “${conversation.name}”`);
    if (reason === RemovalReason.DELETED) toast(`“${conversation.name}” was deleted`);
  };

  const receiveMembersAdded = ({ conversationId, members }) => {
    const known = new Set((get().members[conversationId] ?? []).map((member) => member.id));
    const fresh = members.filter((member) => !known.has(member.id));
    if (get().members[conversationId]) {
      patchMembers(conversationId, (current) => [...current, ...fresh]);
      patchConversation(conversationId, (current) => ({ memberCount: current.memberCount + fresh.length }));
    } else {
      // Member list not loaded here; the count comes from the server on open.
      get().refreshConversation(conversationId);
    }
    set((state) => ({
      presence: { ...state.presence, ...Object.fromEntries(members.map((m) => [m.id, presenceOf(m)])) },
    }));
  };

  const receiveMemberRemoved = ({ conversationId, userId }) => {
    if (get().members[conversationId]) {
      const wasListed = get().members[conversationId].some((member) => member.id === userId);
      patchMembers(conversationId, (members) => members.filter((member) => member.id !== userId));
      if (wasListed) patchConversation(conversationId, (current) => ({ memberCount: current.memberCount - 1 }));
    } else {
      get().refreshConversation(conversationId);
    }
    setTyping(conversationId, userId, null);
  };

  const receiveRoleChanges = ({ conversationId, changes }) => {
    const roles = new Map(changes.map((change) => [change.userId, change.role]));
    patchMembers(conversationId, (members) =>
      members.map((member) => (roles.has(member.id) ? { ...member, role: roles.get(member.id) } : member)),
    );
    // My own role decides which controls I see.
    const mine = roles.get(get().me.id);
    if (mine) patchConversation(conversationId, { role: mine });
  };

  const serverEvents = {
    [ServerEvent.MESSAGE_NEW]: ({ message }) => receiveMessage(message),
    [ServerEvent.MESSAGE_UPDATED]: ({ message }) => receiveUpdatedMessage(message),
    [ServerEvent.MESSAGE_DELETED]: receiveDeletedMessage,
    [ServerEvent.MESSAGE_REACTION]: receiveReaction,
    [ServerEvent.RECEIPT_UPDATE]: receiveReceipt,
    [ServerEvent.TYPING_UPDATE]: ({ conversationId, userId, displayName, isTyping }) =>
      setTyping(conversationId, userId, isTyping ? displayName : null),
    [ServerEvent.PRESENCE_UPDATE]: receivePresence,
    [ServerEvent.CONVERSATION_ADDED]: ({ conversation }) => storeConversation(conversation),
    [ServerEvent.CONVERSATION_UPDATED]: ({ conversationId, name, avatarUrl }) =>
      patchConversation(conversationId, { name, avatarUrl }),
    [ServerEvent.CONVERSATION_REMOVED]: receiveRemoval,
    [ServerEvent.MEMBER_ADDED]: receiveMembersAdded,
    [ServerEvent.MEMBER_REMOVED]: receiveMemberRemoved,
    [ServerEvent.MEMBER_ROLE_CHANGED]: receiveRoleChanges,
  };

  /* ------------------------------------------------------------------ */
  /* Actions                                                            */
  /* ------------------------------------------------------------------ */

  return {
    ...initialState,

    /** Opens the realtime connection for the signed-in user. */
    start(me) {
      if (get().me?.id === me.id && get().connection !== Connection.IDLE) return;
      set({ ...initialState, me, connection: Connection.CONNECTING });
      connectSocket({
        onReady: () => get().onReady(),
        onDisconnect: () => {
          if (get().connection !== Connection.IDLE) set({ connection: Connection.RECONNECTING });
        },
        events: serverEvents,
      });
      // Shown straight away; refreshed again once the socket is ready.
      get().loadConversations().catch(() => {});
    },

    stop() {
      disconnectSocket();
      for (const timer of typingTimers.values()) clearTimeout(timer);
      typingTimers.clear();
      set({ ...initialState });
    },

    /**
     * Runs on the first connection and after every reconnection. The server
     * only sends `session:ready` once this socket is in all of its rooms, so
     * what is fetched here plus the events that follow leaves no gap.
     */
    async onReady() {
      const reconnected = get().connection === Connection.RECONNECTING;
      set({ connection: Connection.CONNECTED });

      try {
        await get().loadConversations();
      } catch {
        // Stay on what we have; the next reconnect will try again.
      }

      const { activeId } = get();
      if (reconnected) {
        // Threads that are not on screen are dropped and reloaded when next
        // opened; only their unsent messages are kept, for flushOutbox below.
        set((state) => {
          const threads = {};
          for (const [id, thread] of Object.entries(state.threads)) {
            const unsent = thread.items.filter((item) => item.localStatus);
            if (id === activeId) threads[id] = thread;
            else if (unsent.length > 0) threads[id] = { ...EMPTY_THREAD, items: unsent };
          }
          return {
            threads,
            members: activeId && state.members[activeId] ? { [activeId]: state.members[activeId] } : {},
          };
        });
        if (activeId && get().conversations[activeId]) {
          get().loadDetail(activeId);
          await get().syncThread(activeId);
        }
      }

      get().flushOutbox();
      if (activeId) get().markRead(activeId);
    },

    async loadConversations() {
      const { conversations } = await api('/api/conversations');
      set((state) => {
        const next = {};
        const presence = { ...state.presence };
        for (const conversation of conversations) {
          next[conversation.id] = mergeConversation(state.conversations[conversation.id], conversation);
          if (conversation.peer) presence[conversation.peer.id] = presenceOf(conversation.peer);
        }
        return { conversations: next, listLoaded: true, presence };
      });
    },

    /** Loads one conversation and its members. Forgets it if we are not in it. */
    async loadDetail(conversationId) {
      try {
        const { conversation, members } = await api(`/api/conversations/${conversationId}`);
        storeConversation(conversation);
        storeMembers(conversationId, members);
      } catch (err) {
        if (err.status === 403 || err.status === 404) forgetConversation(conversationId);
      }
    },

    async refreshConversation(conversationId) {
      try {
        const { conversation } = await api(`/api/conversations/${conversationId}`);
        storeConversation(conversation);
      } catch {
        // Not critical: the next list refresh corrects it.
      }
    },

    setActive(conversationId) {
      set({ activeId: conversationId });
      if (conversationId) get().openConversation(conversationId);
    },

    async openConversation(conversationId) {
      if (!get().members[conversationId]) get().loadDetail(conversationId);
      if (!get().threads[conversationId]?.loaded) await get().loadThread(conversationId);
      get().markRead(conversationId);
    },

    /** Newest page of a conversation. Messages still being sent are kept. */
    async loadThread(conversationId) {
      if (get().threads[conversationId]?.loading) return;
      patchThread(conversationId, (thread) => ({ ...thread, loading: true }));
      try {
        const { messages, hasMore } = await api(`/api/conversations/${conversationId}/messages`);
        patchThread(conversationId, (thread) => ({
          items: [...messages, ...thread.items.filter((item) => item.localStatus)].sort(bySeq),
          hasMore,
          loading: false,
          loaded: true,
        }));
      } catch {
        patchThread(conversationId, (thread) => ({ ...thread, loading: false }));
      }
    },

    /** Infinite scroll upwards: the page before the oldest message we hold. */
    async loadOlder(conversationId) {
      const thread = get().threads[conversationId];
      if (!thread?.loaded || thread.loading || !thread.hasMore) return;
      const oldest = thread.items.find((item) => item.seq != null);
      if (!oldest) return;

      patchThread(conversationId, (current) => ({ ...current, loading: true }));
      try {
        const { messages, hasMore } = await api(
          `/api/conversations/${conversationId}/messages?before=${oldest.seq}`,
        );
        patchThread(conversationId, (current) => {
          const known = new Set(current.items.map((item) => item.id));
          const older = messages.filter((message) => !known.has(message.id));
          return { ...current, items: [...older, ...current.items], hasMore, loading: false };
        });
      } catch {
        patchThread(conversationId, (current) => ({ ...current, loading: false }));
      }
    },

    /**
     * After a reconnect: fetch the newest page. If it overlaps what is on
     * screen it is merged in, which also picks up edits, deletions and
     * reactions that happened meanwhile. If more than a page was missed the
     * thread is replaced, and older history loads again on scroll.
     */
    async syncThread(conversationId) {
      const thread = get().threads[conversationId];
      if (!thread?.loaded) return get().loadThread(conversationId);
      try {
        const { messages, hasMore } = await api(`/api/conversations/${conversationId}/messages`);
        patchThread(conversationId, (current) => {
          const pending = current.items.filter((item) => item.localStatus);
          const newestKnown = Math.max(0, ...current.items.map((item) => item.seq ?? 0));
          const overlaps = messages.length === 0 || messages[0].seq <= newestKnown || !hasMore;
          if (!overlaps) return { items: [...messages, ...pending].sort(bySeq), hasMore, loading: false, loaded: true };

          const fresh = new Map(messages.map((message) => [message.id, message]));
          const kept = current.items.filter((item) => !fresh.has(item.id));
          return { ...current, items: [...kept, ...messages].sort(bySeq) };
        });
      } catch {
        // Keep showing what we have.
      }
    },

    /** Tells the server everything in this conversation has been seen. */
    markRead(conversationId) {
      const conversation = get().conversations[conversationId];
      if (!conversation || get().activeId !== conversationId || !isViewing()) return;
      if (conversation.lastMessageSeq <= conversation.lastReadSeq) {
        if (conversation.unreadCount > 0) patchConversation(conversationId, { unreadCount: 0 });
        return;
      }
      if (!isSocketReady()) return;

      const seq = conversation.lastMessageSeq;
      patchConversation(conversationId, { unreadCount: 0, lastReadSeq: seq });
      request(ClientEvent.CONVERSATION_READ, { conversationId, seq }).catch(() => {});
    },

    markActiveRead() {
      const { activeId } = get();
      if (activeId) get().markRead(activeId);
    },

    /* ----------------------------- messages --------------------------- */

    /**
     * Shows the message immediately and delivers it in the background. The id
     * is generated here and reused for every retry, so the server stores the
     * message once however many times it is sent.
     */
    sendMessage(conversationId, body, attachment = null) {
      const { me } = get();
      const message = {
        id: uuid(),
        seq: null,
        conversationId,
        senderId: me.id,
        sender: { id: me.id, displayName: me.displayName, avatarUrl: me.avatarUrl },
        type: MessageType.TEXT,
        body,
        attachment,
        reactions: [],
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        localStatus: LocalStatus.SENDING,
        attempts: 0,
      };
      patchThread(conversationId, (thread) => ({ ...thread, items: [...thread.items, message].sort(bySeq) }));
      // Move the conversation to the top of the sidebar right away.
      patchConversation(conversationId, { lastActivityAt: message.createdAt });
      get().deliver(conversationId, message.id);
    },

    async deliver(conversationId, messageId) {
      const message = findMessage(conversationId, messageId);
      if (!message?.localStatus) return;

      const setStatus = (localStatus, error = null) =>
        patchMessage(conversationId, messageId, (current) =>
          current.localStatus ? { ...current, localStatus, error } : current,
        );

      if (!isSocketReady()) {
        setStatus(LocalStatus.QUEUED);
        return;
      }

      const attempts = message.attempts + 1;
      patchMessage(conversationId, messageId, (current) => ({
        ...current,
        localStatus: LocalStatus.SENDING,
        error: null,
        attempts,
      }));

      try {
        const payload = { id: message.id, conversationId, body: message.body };
        if (message.attachment) payload.attachmentId = message.attachment.id;
        const { message: stored } = await request(ClientEvent.MESSAGE_SEND, payload);
        receiveMessage(stored);
        // In case the thread was not loaded when the ack arrived.
        patchThread(conversationId, (thread) => ({ ...thread, items: upsertMessage(thread.items, stored) }));
      } catch (err) {
        const transient = [SocketFailure.OFFLINE, SocketFailure.TIMEOUT, ErrorCode.RATE_LIMITED].includes(err.code);
        if (!transient) {
          setStatus(LocalStatus.FAILED, err.message);
        } else if (!isSocketReady()) {
          // Sent again by flushOutbox when the connection is back.
          setStatus(LocalStatus.QUEUED);
        } else if (attempts >= MAX_SEND_ATTEMPTS) {
          setStatus(LocalStatus.FAILED, 'Could not send. Check your connection.');
        } else {
          setTimeout(() => get().deliver(conversationId, messageId), 1000 * attempts);
        }
      }
    },

    /** Manual retry of a failed message, from the "Retry" button. */
    retryMessage(conversationId, messageId) {
      patchMessage(conversationId, messageId, (current) => ({ ...current, attempts: 0 }));
      get().deliver(conversationId, messageId);
    },

    discardMessage(conversationId, messageId) {
      patchThread(conversationId, (thread) => ({
        ...thread,
        items: thread.items.filter((item) => item.id !== messageId || !item.localStatus),
      }));
    },

    /** Sends everything that was written while offline. */
    flushOutbox() {
      for (const [conversationId, thread] of Object.entries(get().threads)) {
        for (const item of thread.items) {
          if (item.localStatus === LocalStatus.QUEUED) get().deliver(conversationId, item.id);
        }
      }
    },

    async editMessage(message, body) {
      const { message: updated } = await request(ClientEvent.MESSAGE_EDIT, { messageId: message.id, body });
      receiveUpdatedMessage(updated);
    },

    async deleteMessage(message) {
      receiveDeletedMessage(await request(ClientEvent.MESSAGE_DELETE, { messageId: message.id }));
    },

    async toggleReaction(message, emoji) {
      const { me } = get();
      const mine = message.reactions.some((r) => r.emoji === emoji && r.userIds.includes(me.id));
      const action = mine ? ReactionAction.REMOVE : ReactionAction.ADD;
      await request(ClientEvent.MESSAGE_REACT, { messageId: message.id, emoji, action });
      receiveReaction({ conversationId: message.conversationId, messageId: message.id, userId: me.id, emoji, action });
    },

    /* ------------------------- conversations -------------------------- */

    /** @returns {Promise<string>} the conversation id, existing or new. */
    async openDirect(userId) {
      const { conversation } = await api('/api/conversations/direct', { method: 'POST', body: { userId } });
      storeConversation(conversation);
      return conversation.id;
    },

    /** @returns {Promise<string>} the new group's id. */
    async createGroup(name, memberIds) {
      const { conversation, members } = await api('/api/conversations/group', {
        method: 'POST',
        body: { name, memberIds },
      });
      storeConversation(conversation);
      storeMembers(conversation.id, members);
      return conversation.id;
    },

    // The server answers these with socket events to the whole group
    // (including this tab), which is what updates the state above.

    updateGroup: (conversationId, changes) =>
      api(`/api/conversations/${conversationId}`, { method: 'PATCH', body: changes }),

    addMembers: (conversationId, userIds) =>
      api(`/api/conversations/${conversationId}/members`, { method: 'POST', body: { userIds } }),

    /** Also "leave group" when `userId` is the signed-in user. */
    removeMember: (conversationId, userId) =>
      api(`/api/conversations/${conversationId}/members/${userId}`, { method: 'DELETE' }),

    changeRole: (conversationId, userId, role) =>
      api(`/api/conversations/${conversationId}/members/${userId}`, { method: 'PATCH', body: { role } }),

    transferOwnership: (conversationId, userId) =>
      api(`/api/conversations/${conversationId}/transfer-ownership`, { method: 'POST', body: { userId } }),

    deleteGroup: (conversationId) => api(`/api/conversations/${conversationId}`, { method: 'DELETE' }),
  };
});
