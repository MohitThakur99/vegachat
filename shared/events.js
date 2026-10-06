/**
 * The socket contract: every event name and the shape of every payload.
 *
 * Client -> server payloads are also validated at runtime by the zod schemas
 * in `server/src/validation/socketSchemas.js`; keep the two in sync.
 *
 * Every client -> server event takes an acknowledgement callback and is
 * answered with an {@link Ack}.
 */

/** Events a client may emit. */
export const ClientEvent = Object.freeze({
  MESSAGE_SEND: 'message:send',
  MESSAGE_EDIT: 'message:edit',
  MESSAGE_DELETE: 'message:delete',
  MESSAGE_REACT: 'message:react',
  CONVERSATION_READ: 'conversation:read',
  CONVERSATION_DELIVERED: 'conversation:delivered',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  AUTH_REFRESH: 'auth:refresh',
});

/** Events the server emits. */
export const ServerEvent = Object.freeze({
  SESSION_READY: 'session:ready',
  AUTH_EXPIRED: 'auth:expired',
  MESSAGE_NEW: 'message:new',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_REACTION: 'message:reaction',
  RECEIPT_UPDATE: 'receipt:update',
  TYPING_UPDATE: 'typing:update',
  PRESENCE_UPDATE: 'presence:update',
  CONVERSATION_ADDED: 'conversation:added',
  CONVERSATION_UPDATED: 'conversation:updated',
  CONVERSATION_REMOVED: 'conversation:removed',
  MEMBER_ADDED: 'member:added',
  MEMBER_REMOVED: 'member:removed',
  MEMBER_ROLE_CHANGED: 'member:role',
});

/* -------------------------------------------------------------------------- */
/* Common shapes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} ErrorPayload
 * @property {string} code      One of `ErrorCode`.
 * @property {string} message   Safe to show to the user.
 * @property {{path: string, message: string}[]} [details]  Per-field problems for VALIDATION_ERROR.
 */

/**
 * @template T
 * @typedef {{ok: true, data: T} | {ok: false, error: ErrorPayload}} Ack
 */

/**
 * @typedef {object} UserRef
 * @property {string} id
 * @property {string} displayName
 * @property {string|null} avatarUrl
 */

/**
 * @typedef {object} Attachment
 * @property {string} id         Fetch the bytes from GET /api/attachments/:id.
 * @property {string} name       Original file name, sanitised.
 * @property {string} mimeType   One of `ALLOWED_UPLOAD_MIME_TYPES`.
 * @property {number} size       Bytes.
 */

/**
 * @typedef {object} Reaction
 * @property {string} emoji        One of `REACTION_EMOJIS`.
 * @property {string[]} userIds    Who reacted with it, oldest first.
 */

/**
 * @typedef {object} Message
 * @property {string} id              UUID chosen by the sending client; the idempotency key.
 * @property {number} seq             Server-assigned, increasing within a conversation. The pagination cursor and the unit of read receipts.
 * @property {string} conversationId
 * @property {string} senderId
 * @property {UserRef} sender
 * @property {string} type            One of `MessageType`.
 * @property {string} body            Empty once deleted.
 * @property {Attachment|null} attachment
 * @property {Reaction[]} reactions
 * @property {string} createdAt       ISO 8601.
 * @property {string|null} editedAt
 * @property {string|null} deletedAt
 */

/**
 * @typedef {object} MessagePreview
 * @property {string} id
 * @property {number} seq
 * @property {string} senderId
 * @property {string} senderName
 * @property {string} type
 * @property {string} body            Truncated.
 * @property {boolean} hasAttachment
 * @property {string} createdAt
 * @property {string|null} deletedAt
 */

/**
 * @typedef {object} Member
 * @property {string} id
 * @property {string} displayName
 * @property {string|null} avatarUrl
 * @property {string} role              One of `Role`.
 * @property {number} lastReadSeq       They have read every message with seq <= this.
 * @property {number} lastDeliveredSeq  Every message with seq <= this reached one of their devices.
 * @property {boolean} online
 * @property {string|null} lastSeenAt
 * @property {string} joinedAt
 */

/**
 * A conversation as seen by one particular user: `role`, `lastReadSeq`,
 * `unreadCount` and `peer` differ per recipient.
 *
 * @typedef {object} Conversation
 * @property {string} id
 * @property {string} type              One of `ConversationType`.
 * @property {string|null} name         Group name; null for direct chats.
 * @property {string|null} avatarUrl
 * @property {string} role              The recipient's own role.
 * @property {number} memberCount
 * @property {number} lastMessageSeq
 * @property {number} lastReadSeq       The recipient's own read watermark.
 * @property {number} unreadCount
 * @property {MessagePreview|null} lastMessage
 * @property {(Member & {role: undefined})|null} peer  The other person in a direct chat; null for groups.
 * @property {string} lastActivityAt    Sort key for the sidebar.
 * @property {string} createdAt
 */

/* -------------------------------------------------------------------------- */
/* Client -> server                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `message:send` — any member of the conversation.
 * Retrying with the same `id` never creates a second message.
 * Ack data: `{ message: Message }`.
 *
 * @typedef {object} MessageSendPayload
 * @property {string} id               Client-generated UUID.
 * @property {string} conversationId
 * @property {string} [body]           1..MESSAGE_MAX_LENGTH chars; optional only when `attachmentId` is set.
 * @property {string} [attachmentId]   An attachment this user uploaded to this conversation and has not used yet.
 */

/**
 * `message:edit` — the sender only, while still a member.
 * Ack data: `{ message: Message }`.
 *
 * @typedef {object} MessageEditPayload
 * @property {string} messageId
 * @property {string} body
 */

/**
 * `message:delete` — the sender only, within DELETE_WINDOW_MS of sending.
 * Ack data: `{ conversationId, messageId, deletedAt }`.
 *
 * @typedef {object} MessageDeletePayload
 * @property {string} messageId
 */

/**
 * `message:react` — any member. Idempotent: adding twice or removing twice is a no-op.
 * Ack data: `null`.
 *
 * @typedef {object} MessageReactPayload
 * @property {string} messageId
 * @property {string} emoji    One of `REACTION_EMOJIS`.
 * @property {string} action   One of `ReactionAction`.
 */

/**
 * `conversation:read` and `conversation:delivered` — any member.
 * "I have read / received everything up to `seq`". Watermarks only move forward.
 * Ack data: `{ conversationId, userId, lastReadSeq, lastDeliveredSeq }`.
 *
 * @typedef {object} WatermarkPayload
 * @property {string} conversationId
 * @property {number} seq
 */

/**
 * `typing:start` and `typing:stop` — any member. Ack data: `null`.
 *
 * @typedef {object} TypingPayload
 * @property {string} conversationId
 */

/**
 * `auth:refresh` — hand the socket a fresh access token before the old one
 * expires. The token must belong to the user the socket connected as.
 * Ack data: `{ expiresAt: number }` (ms since epoch).
 *
 * @typedef {object} AuthRefreshPayload
 * @property {string} token
 */

/* -------------------------------------------------------------------------- */
/* Server -> client                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `session:ready` — to the connecting socket once it has joined all of its
 * rooms. Anything fetched over REST after this point cannot miss an event.
 *
 * @typedef {object} SessionReadyPayload
 * @property {string} userId
 * @property {string} serverTime   ISO 8601.
 */

/**
 * `auth:expired` — to a socket whose access token ran out; the server
 * disconnects it straight after.
 *
 * @typedef {object} AuthExpiredPayload
 * @property {string} message
 */

/**
 * `message:new` and `message:updated` — to the conversation room.
 *
 * @typedef {object} MessageEventPayload
 * @property {Message} message
 */

/**
 * `message:deleted` — to the conversation room.
 *
 * @typedef {object} MessageDeletedPayload
 * @property {string} conversationId
 * @property {string} messageId
 * @property {string} deletedAt
 */

/**
 * `message:reaction` — to the conversation room.
 *
 * @typedef {object} MessageReactionPayload
 * @property {string} conversationId
 * @property {string} messageId
 * @property {string} userId
 * @property {string} emoji
 * @property {string} action   One of `ReactionAction`.
 */

/**
 * `receipt:update` — to the conversation room when a member's watermarks move.
 *
 * @typedef {object} ReceiptUpdatePayload
 * @property {string} conversationId
 * @property {string} userId
 * @property {number} lastReadSeq
 * @property {number} lastDeliveredSeq
 */

/**
 * `typing:update` — to the conversation room, except the typist.
 *
 * @typedef {object} TypingUpdatePayload
 * @property {string} conversationId
 * @property {string} userId
 * @property {string} displayName
 * @property {boolean} isTyping
 */

/**
 * `presence:update` — to everyone who shares a conversation with the user,
 * when their first connection opens or their last one closes.
 *
 * @typedef {object} PresenceUpdatePayload
 * @property {string} userId
 * @property {boolean} online
 * @property {string|null} lastSeenAt
 */

/**
 * `conversation:added` — to one user's own room when they gain a conversation
 * (a direct chat was started with them, or they were added to a group).
 *
 * @typedef {object} ConversationAddedPayload
 * @property {Conversation} conversation
 */

/**
 * `conversation:updated` — to the conversation room when the name or avatar changes.
 *
 * @typedef {object} ConversationUpdatedPayload
 * @property {string} conversationId
 * @property {string} name
 * @property {string|null} avatarUrl
 */

/**
 * `conversation:removed` — to a user who was removed or left (their own room),
 * or to the whole room when the group is deleted. The user's sockets have
 * already been taken out of the room when this arrives.
 *
 * @typedef {object} ConversationRemovedPayload
 * @property {string} conversationId
 * @property {string} reason   One of `RemovalReason`.
 */

/**
 * `member:added` — to the conversation room.
 *
 * @typedef {object} MemberAddedPayload
 * @property {string} conversationId
 * @property {Member[]} members
 */

/**
 * `member:removed` — to the remaining members.
 *
 * @typedef {object} MemberRemovedPayload
 * @property {string} conversationId
 * @property {string} userId
 */

/**
 * `member:role` — to the conversation room after a promotion, demotion or
 * ownership transfer (a transfer carries two changes).
 *
 * @typedef {object} MemberRoleChangedPayload
 * @property {string} conversationId
 * @property {{userId: string, role: string}[]} changes
 */

export {};
