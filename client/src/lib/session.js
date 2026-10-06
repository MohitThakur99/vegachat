/**
 * The access token lives in memory only. It is never written to localStorage
 * or a readable cookie, so a script injected into the page cannot lift a
 * long-lived credential. After a reload it is re-issued from the httpOnly
 * refresh cookie.
 */
let accessToken = null;
const listeners = new Set();

export const getAccessToken = () => accessToken;

export function setAccessToken(token) {
  accessToken = token;
  for (const listener of listeners) listener(token);
}

/** @returns {() => void} unsubscribe */
export function onAccessTokenChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
