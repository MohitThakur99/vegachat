import { create } from 'zustand';
import { api, applySession, clearSession, refreshSession, setSessionLostHandler } from '../lib/api.js';

export const AuthStatus = Object.freeze({
  LOADING: 'loading',
  AUTHENTICATED: 'authenticated',
  GUEST: 'guest',
});

// Signing out in one tab signs out the others straight away, instead of
// leaving them usable until their access token runs out.
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('vegachat-auth') : null;
const SIGNED_OUT = 'signed-out';

const authRequest = (path, body) => api(path, { method: 'POST', body, auth: false, cookies: true });

export const useAuth = create((set, get) => ({
  status: AuthStatus.LOADING,
  user: null,

  /** On page load: is there still a session behind the refresh cookie? */
  async bootstrap() {
    try {
      const { user } = await refreshSession();
      set({ status: AuthStatus.AUTHENTICATED, user });
    } catch {
      set({ status: AuthStatus.GUEST, user: null });
    }
  },

  async login(credentials) {
    const data = await authRequest('/api/auth/login', credentials);
    applySession(data);
    set({ status: AuthStatus.AUTHENTICATED, user: data.user });
  },

  async signup(details) {
    const data = await authRequest('/api/auth/signup', details);
    applySession(data);
    set({ status: AuthStatus.AUTHENTICATED, user: data.user });
  },

  async logout() {
    try {
      await authRequest('/api/auth/logout');
    } catch {
      // Sign out locally even if the server cannot be reached.
    }
    get().endSession();
    channel?.postMessage(SIGNED_OUT);
  },

  endSession() {
    clearSession();
    set({ status: AuthStatus.GUEST, user: null });
  },
}));

setSessionLostHandler(() => useAuth.getState().endSession());

channel?.addEventListener('message', (event) => {
  if (event.data === SIGNED_OUT) useAuth.getState().endSession();
});
