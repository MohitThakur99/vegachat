/**
 * The only place that knows room names and talks to the Socket.IO server on
 * behalf of services. Every function is a no-op until `attach` is called, so
 * services can run without a socket server (scripts, tests).
 *
 * Rooms:
 *   user:<userId>          every socket of one user (all tabs and devices)
 *   conv:<conversationId>  every socket of every current member
 *
 * Clients cannot join or leave rooms themselves: there is no event for it.
 * Room membership is derived from the database, here and at connection time.
 */

/** @type {import('socket.io').Server | null} */
let io = null;

export const rooms = Object.freeze({
  user: (userId) => `user:${userId}`,
  conversation: (conversationId) => `conv:${conversationId}`,
});

export function attach(server) {
  io = server;
}

export function emitToConversation(conversationId, event, payload) {
  io?.to(rooms.conversation(conversationId)).emit(event, payload);
}

export function emitToUser(userId, event, payload) {
  io?.to(rooms.user(userId)).emit(event, payload);
}

/**
 * Emits once to every socket in any of the given conversations.
 *
 * The empty check matters: Socket.IO treats `to([])` as "no room filter" and
 * would broadcast to every connected socket.
 *
 * @param {string[]} conversationIds
 * @param {string} event
 * @param {object} payload
 * @param {import('socket.io').Socket} [exceptSocket]  Skip this socket.
 */
export function emitToConversations(conversationIds, event, payload, exceptSocket) {
  if (!io || conversationIds.length === 0) return;
  const targets = conversationIds.map(rooms.conversation);
  (exceptSocket ? exceptSocket.to(targets) : io.to(targets)).emit(event, payload);
}

/** Subscribes every live socket of these users to the conversation. */
export function joinUsersToConversation(userIds, conversationId) {
  if (!io) return;
  for (const userId of userIds) {
    io.in(rooms.user(userId)).socketsJoin(rooms.conversation(conversationId));
  }
}

/** Unsubscribes every live socket of these users. Takes effect immediately. */
export function removeUsersFromConversation(userIds, conversationId) {
  if (!io) return;
  for (const userId of userIds) {
    io.in(rooms.user(userId)).socketsLeave(rooms.conversation(conversationId));
  }
}

/** Empties a conversation room, for when the conversation is deleted. */
export function closeConversation(conversationId) {
  const room = rooms.conversation(conversationId);
  io?.in(room).socketsLeave(room);
}
