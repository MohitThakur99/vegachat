/**
 * Enums and limits shared by the server and the client.
 *
 * Nothing in this folder may import from `server/` or `client/`, or use a
 * Node-only or browser-only API: both sides load these files as-is.
 */

/** Role of a user inside a conversation. Direct chats only ever use MEMBER. */
export const Role = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
});

export const ConversationType = Object.freeze({
  DIRECT: 'direct',
  GROUP: 'group',
});

export const MessageType = Object.freeze({
  TEXT: 'text',
  /** Written by the server for membership changes ("Rahul added Priya"). */
  SYSTEM: 'system',
});

export const ReactionAction = Object.freeze({
  ADD: 'add',
  REMOVE: 'remove',
});

/** Why a conversation disappeared from a user's list. */
export const RemovalReason = Object.freeze({
  REMOVED: 'removed',
  LEFT: 'left',
  DELETED: 'deleted',
});

/** `error.code` of every REST error body and every failed socket ack. */
export const ErrorCode = Object.freeze({
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL: 'INTERNAL_ERROR',
});

export const Limits = Object.freeze({
  DISPLAY_NAME_MIN: 2,
  DISPLAY_NAME_MAX: 40,
  PASSWORD_MIN: 8,
  /** bcrypt ignores everything after 72 bytes. */
  PASSWORD_MAX: 72,
  MESSAGE_MAX_LENGTH: 4000,
  GROUP_NAME_MAX: 60,
  GROUP_MAX_MEMBERS: 100,
  AVATAR_URL_MAX: 500,
  SEARCH_QUERY_MAX: 50,
  PAGE_SIZE_DEFAULT: 30,
  PAGE_SIZE_MAX: 100,
  /** "Delete for everyone" is allowed for this long after sending. */
  DELETE_WINDOW_MS: 10 * 60 * 1000,
  /** A client sends at most one `typing:start` per conversation in this window. */
  TYPING_THROTTLE_MS: 2000,
  /** A receiver hides "X is typing…" if it hears nothing for this long. */
  TYPING_TIMEOUT_MS: 5000,
  UPLOAD_MAX_BYTES: 5 * 1024 * 1024,
  FILE_NAME_MAX: 120,
});

/** The only emoji accepted as reactions. */
export const REACTION_EMOJIS = Object.freeze(['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥']);

export const IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export const ALLOWED_UPLOAD_MIME_TYPES = Object.freeze([
  ...IMAGE_MIME_TYPES,
  'application/pdf',
  'text/plain',
]);
