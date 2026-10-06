import { create } from 'zustand';

const THEME_KEY = 'vegachat-theme';
const TOAST_MS = 4500;

let nextToastId = 1;

/** Theme and transient notifications. */
export const useUi = create((set, get) => ({
  dark: document.documentElement.classList.contains('dark'),
  toasts: [],

  toggleTheme() {
    const dark = !get().dark;
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // Private mode: the choice just will not persist.
    }
    set({ dark });
  },

  /** @param {'info'|'error'} [kind] */
  toast(message, kind = 'info') {
    const id = nextToastId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }));
    setTimeout(() => get().dismissToast(id), TOAST_MS);
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

export const toast = (message, kind) => useUi.getState().toast(message, kind);
export const toastError = (err) => toast(err?.message ?? 'Something went wrong', 'error');
