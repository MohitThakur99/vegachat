import { io } from 'socket.io-client';
import { ErrorCode } from '@shared/constants.js';
import { ClientEvent, ServerEvent } from '@shared/events.js';
import { API_URL, ApiError, refreshSession } from './api.js';
import { getAccessToken, onAccessTokenChange } from './session.js';

export class SocketError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SocketError';
    this.code = code;
  }
}

/** Client-side codes, alongside the server's `ErrorCode`. */
export const SocketFailure = Object.freeze({ OFFLINE: 'OFFLINE', TIMEOUT: 'TIMEOUT' });

let socket = null;
let ready = false;
let recovering = false;

/** True once the server has confirmed the socket is in all of its rooms. */
export const isSocketReady = () => ready && Boolean(socket?.connected);

/**
 * The server refused or dropped us because the access token is no longer
 * valid. Get a new one and connect again. If the refresh itself is rejected
 * the session-lost handler in api.js signs the user out.
 */
async function recoverAuth() {
  if (recovering || !socket) return;
  recovering = true;
  try {
    await refreshSession();
    socket?.connect();
  } catch (err) {
    // Network trouble rather than a rejected session: try again shortly.
    if (!(err instanceof ApiError)) setTimeout(() => socket && !socket.connected && recoverAuth(), 3000);
  } finally {
    recovering = false;
  }
}

/**
 * @param {object} options
 * @param {() => void} options.onReady           Fired on every (re)connection once the session is usable.
 * @param {() => void} options.onDisconnect
 * @param {Record<string, (payload: any) => void>} options.events  Server event name -> handler.
 */
export function connectSocket({ onReady, onDisconnect, events }) {
  if (socket) return;

  socket = io(API_URL || undefined, {
    // A function, so every reconnection attempt sends the current token
    // rather than the one that was valid when the page loaded.
    auth: (callback) => callback({ token: getAccessToken() }),
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });

  socket.on(ServerEvent.SESSION_READY, () => {
    ready = true;
    onReady();
  });

  socket.on('disconnect', (reason) => {
    ready = false;
    onDisconnect();
    // Socket.IO does not reconnect by itself after the server closes the
    // connection, which is what happens when the token expires.
    if (reason === 'io server disconnect') recoverAuth();
  });

  socket.on('connect_error', (err) => {
    ready = false;
    const code = err?.data?.code;
    if (code === ErrorCode.UNAUTHENTICATED || code === ErrorCode.TOKEN_EXPIRED) recoverAuth();
    // Anything else is a network problem; Socket.IO keeps retrying on its own.
  });

  for (const [event, handler] of Object.entries(events)) socket.on(event, handler);
}

export function disconnectSocket() {
  ready = false;
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

// Long-lived sockets: whenever the access token is renewed, hand the new one
// to the server so it does not disconnect us when the old one expires.
onAccessTokenChange((token) => {
  if (token && socket?.connected) socket.emit(ClientEvent.AUTH_REFRESH, { token }, () => {});
});

/**
 * Emits an event and resolves with the `data` of its acknowledgement.
 *
 * @throws {SocketError} with the server's error code, or OFFLINE / TIMEOUT.
 */
export function request(event, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new SocketError(SocketFailure.OFFLINE, 'You are offline'));
      return;
    }
    socket.timeout(timeoutMs).emit(event, payload, (err, ack) => {
      if (err) reject(new SocketError(SocketFailure.TIMEOUT, 'The server did not respond'));
      else if (ack?.ok) resolve(ack.data);
      else reject(new SocketError(ack?.error?.code ?? ErrorCode.INTERNAL, ack?.error?.message ?? 'Something went wrong'));
    });
  });
}

/** Fire-and-forget, for signals where a lost event does not matter (typing). */
export function signal(event, payload) {
  if (isSocketReady()) socket.volatile.emit(event, payload, () => {});
}
