/**
 * Who is online, tracked per connection rather than per user: a user is online
 * while at least one of their sockets (tabs, devices) is connected.
 *
 * State is in memory, which is correct for a single server process. See the
 * README for what running several instances would need.
 */

/** Keeps a user "online" across a page refresh or a brief network blip. */
const OFFLINE_GRACE_MS = 2500;

/** @type {Map<string, Set<string>>} userId -> ids of their connected sockets */
const socketsByUser = new Map();

/** @type {Map<string, NodeJS.Timeout>} userId -> pending "went offline" timer */
const offlineTimers = new Map();

export function isOnline(userId) {
  return socketsByUser.has(userId) || offlineTimers.has(userId);
}

/**
 * @returns {boolean} true when this is what brought the user online, i.e. the
 *   caller should announce it.
 */
export function addSocket(userId, socketId) {
  const wasOnline = isOnline(userId);

  const pending = offlineTimers.get(userId);
  if (pending) {
    clearTimeout(pending);
    offlineTimers.delete(userId);
  }

  let sockets = socketsByUser.get(userId);
  if (!sockets) {
    sockets = new Set();
    socketsByUser.set(userId, sockets);
  }
  sockets.add(socketId);

  return !wasOnline;
}

/**
 * @param {() => void} onOffline  Called once the user's last socket has been
 *   gone for the grace period. Not called if another socket remains or one
 *   reconnects in time.
 */
export function removeSocket(userId, socketId, onOffline) {
  const sockets = socketsByUser.get(userId);
  if (!sockets || !sockets.delete(socketId)) return;
  if (sockets.size > 0) return;

  socketsByUser.delete(userId);
  const timer = setTimeout(() => {
    offlineTimers.delete(userId);
    onOffline();
  }, OFFLINE_GRACE_MS);
  timer.unref?.();
  offlineTimers.set(userId, timer);
}
