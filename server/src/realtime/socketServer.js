import { Server } from 'socket.io';
import { config } from '../config.js';
import { ServerEvent } from '../shared.js';
import { describeError, unauthenticated } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { listConversationIds } from '../services/conversationService.js';
import { markAllDelivered } from '../services/messageService.js';
import * as presence from '../services/presence.js';
import { getUserById, touchLastSeen } from '../services/userService.js';
import * as gateway from './gateway.js';
import { registerHandlers } from './handlers.js';
import { scheduleTokenExpiry } from './tokenExpiry.js';

/**
 * Handshake authentication. Runs before the connection is established: a
 * socket without a valid access token is refused here and never reaches the
 * `connection` handler, so it cannot receive or emit a single event.
 */
async function authenticateSocket(socket, next) {
  try {
    const { userId, expiresAt } = verifyAccessToken(socket.handshake.auth?.token);
    const user = await getUserById(userId);
    if (!user) throw unauthenticated('Account no longer exists');

    socket.data.userId = user.id;
    socket.data.displayName = user.displayName;
    socket.data.tokenExpiresAt = expiresAt;
    next();
  } catch (err) {
    const { body, expected } = describeError(err);
    if (!expected) console.error('Socket handshake failed', err);
    const refusal = new Error(body.message);
    // Reaches the client as `connect_error.data`.
    refusal.data = body;
    next(refusal);
  }
}

/**
 * Puts the socket in its conversation rooms, announces presence and reports
 * readiness. The socket is already in its `user:` room (see the connection
 * handler), so group changes made while this runs still reach it.
 */
async function startSession(socket) {
  const { userId } = socket.data;

  // The only place a socket is subscribed to conversations it already belongs
  // to. The ids come from the database, never from the client.
  const initialIds = await listConversationIds(userId);
  if (socket.disconnected) return;
  await socket.join(initialIds.map(gateway.rooms.conversation));

  // Read again now that the socket is in its rooms. A removal that committed
  // while the first list was in flight ran its "leave room" before this
  // socket had joined, and would otherwise leave it subscribed.
  const conversationIds = await listConversationIds(userId);
  const current = new Set(conversationIds);
  for (const id of initialIds) {
    if (!current.has(id)) socket.leave(gateway.rooms.conversation(id));
  }

  // Checked after the last await above: registering a socket that has already
  // gone would leave the user shown as online forever.
  if (socket.disconnected) return;

  if (presence.addSocket(userId, socket.id)) {
    gateway.emitToConversations(
      conversationIds,
      ServerEvent.PRESENCE_UPDATE,
      { userId, online: true, lastSeenAt: null },
      socket,
    );
  }

  // Whatever was sent while this user was offline has now reached a device.
  for (const receipt of await markAllDelivered(userId)) {
    gateway.emitToConversation(receipt.conversationId, ServerEvent.RECEIPT_UPDATE, receipt);
  }

  // From here on the socket receives every event for its conversations, so a
  // client that fetches state after this point cannot miss anything.
  socket.emit(ServerEvent.SESSION_READY, { userId, serverTime: new Date().toISOString() });
}

function endSession(socket) {
  const { userId } = socket.data;
  clearTimeout(socket.data.expiryTimer);

  // Offline only once the user's last socket has gone (and stayed gone).
  presence.removeSocket(userId, socket.id, async () => {
    try {
      const lastSeenAt = await touchLastSeen(userId);
      const conversationIds = await listConversationIds(userId);
      gateway.emitToConversations(conversationIds, ServerEvent.PRESENCE_UPDATE, {
        userId,
        online: false,
        lastSeenAt,
      });
    } catch (err) {
      console.error('Failed to record last seen', err);
    }
  });
}

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigins, credentials: true },
    // Far above the largest valid payload (a 4000 character message).
    maxHttpBufferSize: 64 * 1024,
  });

  gateway.attach(io);
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    // Synchronously, before anything else: being in the `user:` room is how
    // this socket is found when its user is added to or removed from a group.
    socket.join(gateway.rooms.user(socket.data.userId));
    // Handlers next, so nothing the client sends during startup is dropped.
    registerHandlers(socket);
    scheduleTokenExpiry(socket);
    socket.on('disconnect', () => endSession(socket));

    startSession(socket).catch((err) => {
      console.error('Failed to start socket session', err);
      socket.disconnect(true);
    });
  });

  return io;
}
