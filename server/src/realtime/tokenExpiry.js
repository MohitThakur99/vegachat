import { ServerEvent } from '../shared.js';

/**
 * A socket outlives the access token it connected with. When the token runs
 * out the socket is told and disconnected, unless the client has handed over
 * a newer token first (`auth:refresh`, see handlers.js), which re-arms this.
 */
export function scheduleTokenExpiry(socket) {
  clearTimeout(socket.data.expiryTimer);
  const remainingMs = Math.max(socket.data.tokenExpiresAt - Date.now(), 0);
  socket.data.expiryTimer = setTimeout(() => {
    socket.emit(ServerEvent.AUTH_EXPIRED, { message: 'Access token expired' });
    socket.disconnect(true);
  }, remainingMs);
}
