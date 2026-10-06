import { Moon, Sparkles, Sun } from 'lucide-react';
import { useUi } from '../store/ui.js';

export function Logo({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${className}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
        <Sparkles className="h-4 w-4" />
      </span>
      VegaChat
    </span>
  );
}

export function ThemeToggle({ className = 'icon-btn' }) {
  const dark = useUi((state) => state.dark);
  const toggleTheme = useUi((state) => state.toggleTheme);
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" onClick={toggleTheme} className={className} aria-label={label} title={label}>
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

/** Shared frame for the login and signup pages. */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="relative flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <Logo className="mb-8 text-xl" />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {children}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">{footer}</p>
      </div>
    </div>
  );
}

/** Message for a failed form submit, with the first field-level problem if there is one. */
export function FormError({ error }) {
  if (!error) return null;
  const detail = error.details?.[0]?.message;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
      {detail ?? error.message ?? 'Something went wrong'}
    </p>
  );
}
