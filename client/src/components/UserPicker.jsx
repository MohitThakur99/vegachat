import { useEffect, useState } from 'react';
import { Check, Loader2, Search } from 'lucide-react';
import { api } from '../lib/api.js';
import Avatar from './Avatar.jsx';

const DEBOUNCE_MS = 250;

/**
 * Search box with a result list.
 *
 * @param {object} props
 * @param {(user: {id: string, displayName: string, email: string}) => void} props.onPick
 * @param {string[]} [props.selectedIds]   Shown with a tick (multi-select).
 * @param {string[]} [props.excludeIds]    Never listed (e.g. existing members).
 */
export default function UserPicker({ onPick, selectedIds = [], excludeIds = [] }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [state, setState] = useState('idle');

  useEffect(() => {
    const q = term.trim();
    if (!q) {
      setResults([]);
      setState('idle');
      return undefined;
    }

    setState('loading');
    let cancelled = false;
    // Wait for a pause in typing, and ignore answers to older queries.
    const timer = setTimeout(async () => {
      try {
        const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        if (!cancelled) {
          setResults(users);
          setState('done');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const visible = results.filter((user) => !excludeIds.includes(user.id));

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by name or email"
          aria-label="Search people"
          className="input pl-9"
        />
        {state === 'loading' && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        )}
      </div>

      <ul className="mt-2 max-h-64 overflow-y-auto">
        {visible.map((user) => {
          const selected = selectedIds.includes(user.id);
          return (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => onPick(user)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Avatar id={user.id} name={user.displayName} src={user.avatarUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{user.displayName}</span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</span>
                </span>
                {selected && <Check className="h-5 w-5 shrink-0 text-brand-600" />}
              </button>
            </li>
          );
        })}
      </ul>

      {state === 'done' && visible.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No one found.</p>
      )}
      {state === 'error' && (
        <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">Search failed. Try again.</p>
      )}
      {state === 'idle' && (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Start typing to find people.
        </p>
      )}
    </div>
  );
}
