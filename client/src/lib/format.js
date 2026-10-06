const DAY_MS = 24 * 60 * 60 * 1000;

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const shortDateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const longDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Whole calendar days between `date` and today (0 = today, 1 = yesterday). */
const daysAgo = (date) => Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY_MS);

export const formatTime = (value) => timeFormat.format(new Date(value));

/** Compact timestamp for the sidebar: time today, then weekday, then date. */
export function formatListTime(value) {
  const date = new Date(value);
  const days = daysAgo(date);
  if (days <= 0) return timeFormat.format(date);
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekdayFormat.format(date);
  return shortDateFormat.format(date);
}

/** Label for the separator between days in a conversation. */
export function formatDay(value) {
  const date = new Date(value);
  const days = daysAgo(date);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return longDateFormat.format(date);
}

export const isSameDay = (a, b) => startOfDay(new Date(a)) === startOfDay(new Date(b));

export function formatLastSeen(value) {
  if (!value) return 'Offline';
  const date = new Date(value);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'Last seen just now';
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const days = daysAgo(date);
  if (days <= 0) return `Last seen today at ${timeFormat.format(date)}`;
  if (days === 1) return `Last seen yesterday at ${timeFormat.format(date)}`;
  return `Last seen ${shortDateFormat.format(date)}`;
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initialsOf(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words.length > 1 ? words.at(-1)[0] : '')).toUpperCase();
}

/** "Rahul is typing…", "Rahul and Priya are typing…", "3 people are typing…". */
export function formatTyping(names) {
  if (names.length === 0) return '';
  const first = (name) => name.split(' ')[0];
  if (names.length === 1) return `${first(names[0])} is typing…`;
  if (names.length === 2) return `${first(names[0])} and ${first(names[1])} are typing…`;
  return `${names.length} people are typing…`;
}

/** RFC 4122 v4. `crypto.randomUUID` only exists on https and localhost. */
export function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
